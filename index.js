```js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require('crypto');

const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

// =========================
// Firebase Admin
// =========================

admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url:
      process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url:
      process.env.FIREBASE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
  }),
});

// =========================
// Middleware
// =========================

app.use(express.json());
app.use(cors());

// =========================
// MongoDB
// =========================

const uri = `mongodb+srv://${encodeURIComponent(
  process.env.DB_USER
)}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.9vhoz1t.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// =========================
// Tracking ID
// =========================

function generateTrackingId() {
  const prefix = 'ORD';

  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');

  const randomPart = crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase();

  return `${prefix}-${date}-${randomPart}`;
}

// =========================
// Firebase Token Verification
// =========================

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send('unauthorized access');
  }

  try {
    const idToken = token.split(' ')[1];

    if (!idToken) {
      return res.status(401).send('unauthorized access');
    }

    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    console.error('Firebase token verification error:', err);

    return res.status(401).send({
      message: 'unauthorized access',
    });
  }
};

// =========================
// Main Server
// =========================

async function run() {
  try {
    const db = client.db('local_chef_bazaar_db');

    const usersCollection = db.collection('users');
    const reviewsCollections = db.collection('reviews');
    const mealsCollections = db.collection('meals');
    const ordersCollection = db.collection('orders');
    const paymentsCollection = db.collection('payments');
    const requestsCollection = db.collection('requests');

    // =========================
    // Admin Verification
    // =========================

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;

        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== 'admin') {
          return res.status(403).send('forbidden access');
        }

        next();
      } catch (error) {
        console.error('Admin verification error:', error);

        return res.status(500).send({
          message: 'Failed to verify admin',
        });
      }
    };

    // =========================
    // Users API
    // =========================

    app.post('/users', async (req, res) => {
      try {
        const user = req.body;

        user.role = 'user';
        user.createdAt = new Date();

        const result = await usersCollection.insertOne(user);

        res.send(result);
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: 'Failed to create user',
        });
      }
    });

    app.get('/users', async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;

        if (email) {
          query.email = email;
        }

        const result = await usersCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get users',
        });
      }
    });

    app.get('/users/secure/all', verifyFBToken, async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get users',
        });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne({ email });

        res.send({
          role: user?.role || 'user',
        });
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get user role',
        });
      }
    });

    app.patch('/users/fraud/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            message: 'Invalid user ID',
          });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: 'fraud',
            },
          }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to mark user as fraud',
        });
      }
    });

    // =========================
    // Request API
    // =========================

    app.post('/requests', async (req, res) => {
      try {
        const request = req.body;

        const result = await requestsCollection.insertOne(request);

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to create request',
        });
      }
    });

    app.get('/requests', async (req, res) => {
      try {
        const query = {};

        if (req.query.requestStatus) {
          query.requestStatus = req.query.requestStatus;
        }

        const result = await requestsCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get requests',
        });
      }
    });

    app.get('/requests/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            message: 'Invalid request ID',
          });
        }

        const request = await requestsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!request) {
          return res.status(404).send({
            message: 'Request not found',
          });
        }

        res.send(request);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get request',
        });
      }
    });

    app.patch(
      '/requests/:id',
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { requestStatus } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({
              success: false,
              message: 'Invalid request ID',
            });
          }

          if (!['approved', 'rejected'].includes(requestStatus)) {
            return res.status(400).send({
              success: false,
              message: 'Invalid request status',
            });
          }

          const request = await requestsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!request) {
            return res.status(404).send({
              success: false,
              message: 'Request not found',
            });
          }

          if (request.requestStatus !== 'pending') {
            return res.status(400).send({
              success: false,
              message: `Request is already ${request.requestStatus}`,
            });
          }

          // Reject request
          if (requestStatus === 'rejected') {
            const result = await requestsCollection.updateOne(
              { _id: new ObjectId(id) },
              {
                $set: {
                  requestStatus: 'rejected',
                },
              }
            );

            return res.send({
              success: true,
              message: 'Request rejected successfully',
              modifiedCount: result.modifiedCount,
            });
          }

          // Find user
          const user = await usersCollection.findOne({
            email: request.userEmail,
          });

          if (!user) {
            return res.status(404).send({
              success: false,
              message: 'User not found',
            });
          }

          // Chef request
          if (request.requestType === 'chef') {
            let chefId;
            let chefExists = true;

            while (chefExists) {
              chefId = `chef-${Math.floor(
                1000 + Math.random() * 9000
              )}`;

              const existingChef = await usersCollection.findOne({
                chefId,
              });

              chefExists = !!existingChef;
            }

            await usersCollection.updateOne(
              { email: request.userEmail },
              {
                $set: {
                  role: 'chef',
                  chefId,
                },
              }
            );
          }

          // Admin request
          else if (request.requestType === 'admin') {
            await usersCollection.updateOne(
              { email: request.userEmail },
              {
                $set: {
                  role: 'admin',
                },
              }
            );
          } else {
            return res.status(400).send({
              success: false,
              message: 'Invalid request type',
            });
          }

          const result = await requestsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                requestStatus: 'approved',
              },
            }
          );

          return res.send({
            success: true,
            message: 'Request approved successfully',
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error('Manage request error:', error);

          return res.status(500).send({
            success: false,
            message: 'Failed to manage request',
          });
        }
      }
    );

    // =========================
    // Orders API
    // =========================

    app.get('/orders', async (req, res) => {
      try {
        const query = {};
        const { email, orderStatus } = req.query;

        if (email) {
          query.email = email;
        }

        if (orderStatus) {
          query.orderStatus = orderStatus;
        }

        const result = await ordersCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get orders',
        });
      }
    });

    app.get('/orders/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            message: 'Invalid order ID',
          });
        }

        const result = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get order',
        });
      }
    });

    app.post('/orders', async (req, res) => {
      try {
        const order = req.body;

        const user = await usersCollection.findOne({
          email: order.email,
        });

        if (user && user.status === 'fraud') {
          return res.status(403).send({
            success: false,
            message: 'Fraud users are not allowed to place orders.',
          });
        }

        const result = await ordersCollection.insertOne(order);

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to create order',
        });
      }
    });

    // =========================
    // Meals API
    // =========================

    app.get('/meals', async (req, res) => {
      try {
        const email = req.query.email;

        const query = email ? { email } : {};

        const result = await mealsCollections.find(query).toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get meals',
        });
      }
    });

    app.get('/meals/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            message: 'Invalid meal ID',
          });
        }

        const result = await mealsCollections.findOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get meal',
        });
      }
    });

    app.get('/daily-meals', async (req, res) => {
      try {
        const result = await mealsCollections
          .find()
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get daily meals',
        });
      }
    });

    app.post('/meals', async (req, res) => {
      try {
        const meal = req.body;

        const result = await mealsCollections.insertOne(meal);

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to create meal',
        });
      }
    });

    // =========================
    // Reviews API
    // =========================

    app.get('/reviews', async (req, res) => {
      try {
        const result = await reviewsCollections.find().toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get reviews',
        });
      }
    });

    // =========================
    // Stripe Checkout
    // =========================

    app.post('/create-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;

        const amount = parseInt(paymentInfo.price) * 100;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'USD',
                unit_amount: amount,
                product_data: {
                  name: paymentInfo.orderName,
                },
              },
              quantity: 1,
            },
          ],

          customer_email: paymentInfo.email,

          mode: 'payment',

          metadata: {
            orderId: paymentInfo.orderId,
            orderName: paymentInfo.orderName,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,

          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({
          url: session.url,
        });
      } catch (error) {
        console.error('Stripe checkout error:', error);

        res.status(500).send({
          message: 'Failed to create checkout session',
        });
      }
    });

    // =========================
    // Payment Success
    // =========================

    app.patch('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;

        if (!sessionId) {
          return res.status(400).send({
            message: 'Session ID is required',
          });
        }

        const session =
          await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;

        const paymentExist = await paymentsCollection.findOne({
          transactionId,
        });

        if (paymentExist) {
          return res.send({
            message: 'Payment already exists',
            transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        const trackingId = generateTrackingId();

        if (session.payment_status === 'paid') {
          const id = session.metadata.orderId;

          const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                paymentStatus: 'paid',
                deliveryStatus: 'pending',
                trackingId,
              },
            }
          );

          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            email: session.customer_details.email,
            orderId: session.metadata.orderId,
            orderName: session.metadata.orderName,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
            trackingId,
          };

          const resultPayment =
            await paymentsCollection.insertOne(payment);

          return res.send({
            success: true,
            modifyOrder: result,
            trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }

        return res.send({
          success: false,
        });
      } catch (error) {
        console.error('Payment success error:', error);

        res.status(500).send({
          message: 'Failed to process payment',
        });
      }
    });

    // =========================
    // Payments API
    // =========================

    app.get('/payments', verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        const query = {};

        if (email) {
          query.email = email;

          if (email !== req.decoded_email) {
            return res.status(403).send({
              message: 'Forbidden access',
            });
          }
        }

        const result = await paymentsCollection
          .find(query)
          .sort({ paidAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get payments',
        });
      }
    });

    // =========================
    // Chef Meals
    // =========================

    app.get('/my-meals/:email', async (req, res) => {
      try {
        const email = req.params.email;

        const result = await mealsCollections
          .find({ ChefEmail: email })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: 'Failed to get chef meals',
        });
      }
    });

    // =========================
    // Chef Order Requests
    // =========================

    app.get(
      '/manage-order-requests/:email',
      verifyFBToken,
      async (req, res) => {
        try {
          const email = req.params.email;

          if (email !== req.decoded_email) {
            return res.status(403).send({
              message: 'Forbidden',
            });
          }

          const result = await ordersCollection
            .find({ chefEmail: email })
            .toArray();

          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: 'Failed to get chef orders',
          });
        }
      }
    );

    // =========================
    // Update Chef Order Status
    // =========================

    const updateChefOrderStatus = async (req, res) => {
      try {
        const { orderStatus, status, deliveryStatus } = req.body;

        const newStatus =
          orderStatus || status || deliveryStatus;

        const allowedStatuses = [
          'pending',
          'accepted',
          'delivered',
          'cancelled',
        ];

        if (!allowedStatuses.includes(newStatus)) {
          return res.status(400).send({
            message: 'Invalid order status',
          });
        }

        const chefEmail = req.decoded_email;

        if (!ObjectId.isValid(req.params.id)) {
          return res.status(400).send({
            message: 'Invalid order ID',
          });
        }

        const order = await ordersCollection.findOne({
          _id: new ObjectId(req.params.id),
          chefEmail,
        });

        if (!order) {
          return res.status(404).send({
            message: 'Order not found',
          });
        }

        const currentStatus =
          order.orderStatus ??
          order.deliveryStatus ??
          'pending';

        const validTransitions = {
          pending: ['accepted', 'cancelled'],
          accepted: ['delivered'],
          delivered: [],
          cancelled: [],
        };

        if (
          !validTransitions[currentStatus]?.includes(newStatus)
        ) {
          return res.status(400).send({
            message: `Cannot change status from ${currentStatus} to ${newStatus}`,
          });
        }

        const result = await ordersCollection.updateOne(
          {
            _id: new ObjectId(req.params.id),
            chefEmail,
          },
          {
            $set: {
              orderStatus: newStatus,
              deliveryStatus: newStatus,
            },
          }
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
          orderStatus: newStatus,
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: 'Failed to update order status',
        });
      }
    };

    app.put(
      '/manage-order-requests/:id/status',
      verifyFBToken,
      updateChefOrderStatus
    );

    app.patch(
      '/manage-order-requests/:id/status',
      verifyFBToken,
      updateChefOrderStatus
    );

    console.log('MongoDB APIs are ready');
  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);

// =========================
// Root Route
// =========================

app.get('/', (req, res) => {
  res.send('chef bazaar!');
});

// =========================
// Start Server
// =========================

app.listen(port, () => {
  console.log(`Chef Bazaar server running on port ${port}`);
});
```
