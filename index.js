const express = require('express')
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000

const crypto = require('crypto');

const admin = require("firebase-admin");

const serviceAccount = require("./chef-bazaar-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
  const prefix = 'ORD';

  // Format current date as YYYYMMDD
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Generate 6 random hexadecimal characters
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();

  // Example: ORD-20260514-A1B2C3
  return `${prefix}-${date}-${randomPart}`;
}

// Example usage
const trackingId = generateTrackingId();
console.log(trackingId);

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  // console.log('headers in the middleware', req.headers.authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send('unauthorized access');
  }

  try {
    const idToken = token.split(' ')[1];
    // console.log('id token', idToken);
    const decoded = await admin.auth().verifyIdToken(idToken);



    console.log('decoded token', decoded);


    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' });
  }


  // Here you would typically verify the Firebase token

};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9vhoz1t.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('local_chef_bazaar_db');
    const usersCollection = db.collection('users');
    const reviewsCollections = db.collection('reviews');
    const mealsCollections = db.collection('meals');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const requestsCollection = db.collection('requests');


    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      console.log( req.body);
      const query = { email }
      console.log(query);
      const user = await usersCollection.findOne(query);
      console.log(user);
      if (!user || user.role !== 'admin') {
        return res.status(403).send('forbidden access');
      }

      next();
    };




    //  users Api
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();


      const result = await usersCollection.insertOne(user);
      res.send(result);

    })

   
    app.get('/users', async (req, res) => {
      const query = {}
      const { email } = req.query;

      if (email) {
        query.email = email;
      }
      const cursor = usersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

     app.get('/users', verifyFBToken, async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });


    app.get('/users/:email/role', async(req,res) => {
      const email = req.params.email;
      const query = { email }
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    })


     app.patch('/users/fraud/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const updateDoc = {
    $set: {
      status: 'fraud'
    }
  };
  
  const result = await usersCollection.updateOne(query, updateDoc);
  res.send(result);
     });




    // API for chef or admin request
    app.post("/requests", async (req, res) => {
      const request = req.body;
      const result = await requestsCollection.insertOne(request);
      res.send(result);
    });


    app.get('/requests', async (req, res) => {
      const query = {}

      if (req.query.requestStatus) {
        query.requestStatus = req.query.requestStatus;
      }

      const cursor = requestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/requests/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const request = await requestsCollection.findOne(query);

    if (!request) {
      return res.status(404).send({ message: 'Request not found' });
    }

    res.send(request);
  } catch (error) {
    res.status(500).send({ message: 'Failed to get request', error });
  }
});

    app.patch('/requests/:id',verifyFBToken, verifyAdmin,  async (req, res) => {
      const requestStatus = req.body.requestStatus;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      let resultUser;

      if (requestStatus === 'approved') {
        const { email, requestType, role } = req.body;
        const userQuery = { email }
        const updateUserDoc = {
          $set: { role: role }
        }
         resultUser = await usersCollection.updateOne(userQuery, updateUserDoc);
        console.log(resultUser);
       const updatedDoc = {
        $set: {
          requestStatus: requestStatus
        }
      }
      const result = await requestsCollection.updateOne(query, updatedDoc);
      
      }


      res.send(resultUser);
    }
    )

    // GET user data by email


    //  order Api
    app.get('/orders', async (req, res) => {
      const query = {}
      const { email, orderStatus } = req.query;

      if (email) {
        query.email = email;
      }

      if (orderStatus) {
        query.orderStatus = orderStatus;
      }


      const cursor = ordersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })



    app.get('/orders/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ordersCollection.findOne(query);
      res.send(result);
    })

  //   // Get all orders by chefId
  //   app.get('/orders', async (req, res) => {
  // const chefId = req.query.chefId;

  // const query = chefId ? { chefId } : {};

  // const orders = await ordersCollection.find(query).toArray();
  //   res.send(orders);
  //  });
  

    app.post('/orders', async (req, res) => {
      const order = req.body;
      console.log(order);
       
      // for fraud
     const user = await usersCollection.findOne({
     email: order.email
     });
     console.log(user);

       if (user && user.status === 'fraud') {
    return res.status(403).send({
      success: false,
      message: 'Fraud users are not allowed to place orders.'
    });
  }



      const result = await ordersCollection.insertOne(order);
      res.send(result)
    })

    // app.delete('/orders/:id', async(req,res)=>{
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id)}

    //   const result = await ordersCollection.deleteOne(query);
    //   res.send(result);
    // })



    // meals api




    app.get('/meals', async (req, res) => {
      const cursor = mealsCollections.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/meals/:id', async (req, res) => {
      const id = req.params.id;
      console.log('need meals with id', id);
      const query = { _id: new ObjectId(id) }
      console.log(query);

      const result = await mealsCollections.findOne(query)
      // console.log(result);

      res.send(result);
    })

    app.get('/daily-meals', async (req, res) => {
      const cursor = mealsCollections.find().limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });


     app.post('/meals', async(req,res) => {
      const meal = req.body;
      const result = await mealsCollections.insertOne(meal);
      res.send(result);
    })
    
    // Get meals by chef email
    app.get('/meals', async (req, res) => {
  const email = req.query.email;

  const query = email ? { email } : {};

  const result = await mealsCollection.find(query).toArray();

  res.send(result);
    });



    //    reviews api
    app.get('/reviews', async (req, res) => {
      const cursor = reviewsCollections.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    //   app.post('/reviews', async(req,res) => {
    //     const review = req.body;
    //     const result = await reviewsCollections.insertOne(review);
    //     res.send(result);
    //   })

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;

      const amount = parseInt(paymentInfo.price) * 100;
      console.log(paymentInfo, amount)
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {

            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.orderName
              }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: 'payment',
        metadata: {
          orderId: paymentInfo.orderId,
          orderName: paymentInfo.orderName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session)
      res.send({ url: session.url });
    })

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log('session retrieve', session);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }

      const paymentExist = await paymentsCollection.findOne(query);
      console.log(paymentExist);

      if (paymentExist) {
        res.send({
          message: 'Payment already exsits',
          transactionId,
          trackingId: paymentExist.trackingId
        })
        return;
      }


      const trackingId = generateTrackingId();


      if (session.payment_status === 'paid') {

        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            deliveryStatus: 'pending',
            trackingId: trackingId

          }
        }
        const result = await ordersCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          email: session.customer_details.email,
          orderId: session.metadata.orderId,
          orderName: session.metadata.orderName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }


        if (session.payment_status === 'paid') {
          const resultPayment = await paymentsCollection.insertOne(payment);
          res.send({
            success: true,
            modifyOrder: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment
          });
          paidAt: new Date()

        }

      }

      res.send({ success: false })
    })


    //  payments apis
    app.get('/payments', verifyFBToken, async (req, res) => {

      const email = req.query.email;
      const query = {}
      // console.log('headers',req.headers);

      if (email) {
        query.email = email;

        // check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ messsage: 'forbidden accsess' })


        }
      }

      const cursor = paymentsCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    })
    //  all meals created by specific chefid
   app.get('/my-meals/:email',async (req, res) => {
      const email = req.params.email;
      const result = await mealsCollections.find({ ChefEmail: email }).toArray();
      res.send(result);

    })
      // all orders which is created by chef
    app.get('/manage-order-requests/:email',async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.find({ chefEmail: email }).toArray();
      res.send(result);

    })







    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {

  }
}
run().catch(console.dir);





app.get('/', (req, res) => {
  res.send('chef bazaar!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
