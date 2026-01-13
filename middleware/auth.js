/**
 * Authentication Middleware
 * Handles JWT token verification, user authentication, and authorization
 */

const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');

/**
 * Verify JWT token and authenticate user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = async (req, res, next) => {
  try {
    // 1. Get token from header
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // 2. Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // 3. Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.'
      });
    }

    // 4. Check if user account is active
    if (!currentUser.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account is not active. Please contact support.'
      });
    }

    // 5. Check if user is locked
    // if (currentUser.isLocked) {
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Account is temporarily locked due to too many failed login attempts.'
    //   });
    // }

    // 6. Grant access to protected route
    req.user = { id: decoded.id }; // Will be replaced with actual user data
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token provided
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (token) {
      try {
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
        
        // TODO: Implement user verification
        // const currentUser = await User.findById(decoded.id).select('+status');
        // if (currentUser && currentUser.status === 'active' && !currentUser.isLocked) {
        //   req.user = currentUser;
        // }
        
        req.user = { id: decoded.id }; // Will be replaced with actual user data
      } catch (error) {
        // Token is invalid, but we don't fail - just continue without user
        req.user = null;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

/**
 * Restrict access to specific roles
 * @param {...string} roles - Allowed roles
 * @returns {Function} Middleware function
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    // TODO: Implement role checking
    // if (!req.user || !roles.includes(req.user.role)) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'You do not have permission to perform this action.'
    //   });
    // }
    
    // For now, just check if user is authenticated
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action.'
      });
    }
    
    next();
  };
};

/**
 * Check if user is admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const requireAdmin = (req, res, next) => {
  // TODO: Implement admin check
  // if (!req.user || req.user.role !== 'admin') {
  //   return res.status(403).json({
  //     success: false,
  //     message: 'Admin access required.'
  //   });
  // }
  
  // For now, just check if user is authenticated
  if (!req.user) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.'
    });
  }
  
  next();
};

/**
 * Check if user owns the resource or is admin
 * @param {string} resourceIdParam - Parameter name for resource ID
 * @returns {Function} Middleware function
 */
const requireOwnershipOrAdmin = (resourceIdParam = 'id') => {
  return (req, res, next) => {
    const resourceId = req.params[resourceIdParam];
    
    // TODO: Implement ownership or admin check
    // if (!req.user) {
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Authentication required.'
    //   });
    // }
    
    // if (req.user.role === 'admin' || req.user.id.toString() === resourceId) {
    //   return next();
    // }
    
    // For now, just check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }
    
    next();
  };
};

/**
 * Rate limiting for authentication endpoints
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    const path = req.path || '';
    if (path === '/register') return true;
    if (path === '/verify-otp') return true;
    if (path === '/resend-otp') return true;
    if (path.startsWith('/login/')) return true;
    return false;
  }
});

/**
 * Validate email verification status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const requireEmailVerification = (req, res, next) => {
  // TODO: Implement email verification check
  // if (!req.user || !req.user.isEmailVerified) {
  //   return res.status(403).json({
  //     success: false,
  //     message: 'Email verification required to access this resource.'
  //   });
  // }
  
  next();
};

/**
 * Generate JWT token
 * @param {string} userId - User ID
 * @param {Object} options - Token options
 * @returns {string} JWT token
 */
const generateToken = (userId, options = {}) => {
  const payload = { id: userId };
  const tokenOptions = {
    expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '7d',
    ...options
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
};

/**
 * Set JWT token as HTTP-only cookie
 * @param {Object} res - Express response object
 * @param {string} token - JWT token
 * @param {Object} options - Cookie options
 */
const setTokenCookie = (res, token, options = {}) => {
  const cookieOptions = {
    expires: new Date(
      Date.now() + (process.env.JWT_COOKIE_EXPIRES_IN || 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    ...options
  };
  
  res.cookie('jwt', token, cookieOptions);
};

/**
 * Clear JWT token cookie
 * @param {Object} res - Express response object
 */
const clearTokenCookie = (res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });
};

module.exports = {
  authenticate,
  optionalAuth,
  restrictTo,
  requireAdmin,
  requireOwnershipOrAdmin,
  authRateLimit,
  requireEmailVerification,
  generateToken,
  setTokenCookie,
  clearTokenCookie
};
