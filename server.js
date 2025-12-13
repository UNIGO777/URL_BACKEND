// Load environment variables
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const passport = require('passport');
const session = require('express-session');
const os = require('os');

// Import configuration
const { PORT, MESSAGES } = require('./config/constants');
const DEFAULT_HOST = '0.0.0.0';

// Resolve a valid host to bind. If the requested HOST isn't available,
// fall back to 0.0.0.0 to avoid EADDRNOTAVAIL errors.
function resolveHost(requested) {
  const host = (requested || '').trim();
  if (!host || host.toLowerCase() === 'localhost') return DEFAULT_HOST;
  if (host === '0.0.0.0' || host === '127.0.0.1') return host;

  try {
    const nets = os.networkInterfaces();
    const addrs = Object.values(nets)
      .flat()
      .filter(Boolean)
      .map(a => a.address);
    if (addrs.includes(host)) return host;
    console.warn(`⚠️ HOST ${host} not found on this machine. Falling back to ${DEFAULT_HOST}.`);
  } catch (e) {
    console.warn('⚠️ Unable to validate HOST. Falling back to 0.0.0.0.');
  }
  return DEFAULT_HOST;
}

const HOST = resolveHost(process.env.HOST);
const { connectDB } = require('./config/database');
require('./config/passport'); // Initialize passport strategies

// Import middleware
const corsMiddleware = require('./middleware/cors');
const requestLogger = require('./middleware/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Import routes
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lambdaRoutes = require('./routes/lambda');
const geminiRoutes = require('./routes/gemini');
const linksRoutes = require('./routes/links');
const favsRoutes = require('./routes/favs');
const searchRoutes = require('./routes/search');

// Import Swagger configuration
const { specs, swaggerUi, swaggerOptions } = require('./config/swagger');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration for passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Custom middleware
app.use(corsMiddleware);
// app.use(requestLogger);

// Swagger documentation route
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerOptions));

// Routes
app.use('/', apiRoutes);
app.use('/api/url-extractor', lambdaRoutes);
app.use('/api/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/api/gemini', geminiRoutes);
app.use('/api/links', linksRoutes);
app.use('/api/favs', favsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/share', require('./routes/share'));

// Error handling middleware (must be last)
app.use(errorHandler);
app.use('*', notFoundHandler);

// Connect to database and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start server
    app.listen(PORT, HOST, () => {
      const hostDisplay = (HOST === '0.0.0.0' || HOST === '127.0.0.1') ? 'localhost' : HOST;
      console.log(`\n🚀 ${MESSAGES.SERVER_RUNNING} ${PORT} on ${HOST}`);
      console.log(`📋 Health check: http://${hostDisplay}:${PORT}/health`);
      console.log(`🔗 Execute endpoint: http://${hostDisplay}:${PORT}/api/url-extractor`);
      console.log(`🔐 Auth endpoints: http://${hostDisplay}:${PORT}/api/auth`);
      console.log(`👤 User endpoints: http://${hostDisplay}:${PORT}/users`);
      console.log(`📖 Documentation: http://${hostDisplay}:${PORT}/api-docs\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
