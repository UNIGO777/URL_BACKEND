/**
 * Google OAuth Controller
 * Handles Google OAuth authentication operations
 */

const jwt = require('jsonwebtoken');
const passport = require('passport');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Initiate Google OAuth authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const googleAuth = passport.authenticate('google', {
  scope: ['profile', 'email']
});

/**
 * Google OAuth login with ID token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required'
      });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const {
      sub: googleId,
      email,
      name: fullName,
      picture: avatar,
      email_verified: emailVerified
    } = payload;

    if (!emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Google email is not verified'
      });
    }

    // Only allow Gmail addresses for Google login
    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({
        success: false,
        message: 'Only Gmail addresses are allowed for Google login'
      });
    }

    // Check if user exists with this Google ID
    let user = await User.findOne({ googleId });
    let isNewUser = false;

    if (!user) {
      // Check if user exists with this email as identifier
      user = await User.findOne({ identifier: email.toLowerCase() });
      
      if (user) {
        // Link Google account to existing user
        user.googleId = googleId;
        if (!user.avatar && avatar) {
          user.avatar = avatar;
        }
        user.identifierVerified = true;
        user.registrationStep = 'completed';
        await user.save();
      } else {
        // Create new user with Google account
        user = new User({
          fullName,
          identifier: email.toLowerCase(),
          googleId,
          avatar,
          identifierVerified: true,
          registrationStep: 'completed',
          ageGroup: 'Not specified' // Default value, can be updated later
        });
        await user.save();
        isNewUser = true;
      }
    }

    // Generate JWT token
    const token = user.generateAuthToken();
    
    // Update last login
    user.lastLogin = new Date();
    user.LastActive = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created and login successful' : 'Login successful',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          lastLogin: user.lastLogin,
          isGoogleUser: true
        },
        token,
        isNewUser
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
    
    // Handle specific Google auth errors
    if (error.message.includes('Token used too early') || 
        error.message.includes('Token used too late') ||
        error.message.includes('Invalid token signature')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Google login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Handle Google OAuth callback
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const googleCallback = async (req, res, next) => {
  passport.authenticate('google', { session: true }, async (err, user, info) => {
    try {
      // Check if this is a mobile app request using state parameter or session
      const isMobileApp = req.query.state === 'mobile' || req.session?.isMobile || req.headers['user-agent']?.includes('Expo');
      const mobileScheme = 'exp+my-app://expo-development-client'; // Expo development scheme
      
      if (err) {
        if (isMobileApp) {
          return res.redirect(`${mobileScheme}/?error=${encodeURIComponent('Authentication error')}`);
        }
        return res.redirect(`${process.env.CLIENT_URL}/auth/error?message=${encodeURIComponent('Authentication error')}`);
      }

      if (!user) {
        if (isMobileApp) {
          return res.redirect(`${mobileScheme}/?error=${encodeURIComponent('Authentication failed')}`);
        }
        return res.redirect(`${process.env.CLIENT_URL}/auth/error?message=${encodeURIComponent('Authentication failed')}`);
      }

      // Check if user requires additional information
      if (user.requiresAdditionalInfo) {
        // Generate temporary ID for session tracking
        const tempId = require('crypto').randomBytes(16).toString('hex');
        
        // Store Google data in session for completion
        req.session.tempGoogleData = {
          tempId,
          googleId: user.googleId,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatar
        };

        if (isMobileApp) {
          // For mobile app, redirect with tempId and tempUserData to complete registration (no cookie dependency)
          const tempUserData = {
            googleId: user.googleId,
            fullName: user.fullName,
            email: user.email,
            avatar: user.avatar,
          };
          return res.redirect(`${mobileScheme}/?tempId=${tempId}&action=complete&tempUserData=${encodeURIComponent(JSON.stringify(tempUserData))}`);
        }
        // Redirect to frontend form to collect additional info
        const tempUserData = encodeURIComponent(JSON.stringify({
          googleId: user.googleId,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatar,
        }));
        return res.redirect(`${process.env.CLIENT_URL}/auth/complete?tempId=${tempId}&tempUserData=${tempUserData}`);
      }

      // User already exists, generate token and redirect
      const token = user.generateAuthToken();
      
      // Update last login
      user.lastLogin = new Date();
      user.LastActive = new Date();
      await user.save();

      if (isMobileApp) {
        // For mobile app, redirect with token and user data
        const userData = {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          isGoogleUser: true
        };
        
        return res.redirect(`${mobileScheme}/?token=${token}&userData=${encodeURIComponent(JSON.stringify(userData))}&success=true`);
      }

      // Redirect to frontend with token
      res.redirect(`${process.env.CLIENT_URL}/auth/success?token=${token}`);
    } catch (error) {
      console.error('Google callback error:', error);
      if (isMobileApp) {
        return res.redirect(`${mobileScheme}/?error=${encodeURIComponent('Authentication processing failed')}`);
      }
      res.redirect(`${process.env.CLIENT_URL}/auth/error?message=${encodeURIComponent('Authentication processing failed')}`);
    }
  })(req, res, next);
};

/**
 * Get Google OAuth URL for frontend
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getGoogleAuthURL = async (req, res) => {
  try {
    const isMobile = req.query.mobile === 'true';
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback';
    
    // Store mobile state in session for callback handling
    if (!req.session) {
      req.session = {};
    }
    req.session.isMobile = isMobile;
    
    // Create OAuth2Client with proper configuration using base callback URL
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl
    );

    // Generate auth URL using the proper Google OAuth2Client method
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['profile', 'email'],
      prompt: 'consent',
      state: isMobile ? 'mobile' : 'web' // Use state parameter to track mobile vs web
    });

    res.status(200).json({
      success: true,
      data: {
        authUrl,
        clientId: process.env.GOOGLE_CLIENT_ID,
        isMobile
      }
    });

  } catch (error) {
    console.error('Get Google auth URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate Google auth URL',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Handle successful Google authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const googleSuccess = async (req, res) => {
  try {
    // Get token from query parameters (set by googleCallback)
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    // Verify and decode the token to get user data
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          lastLogin: user.lastLogin,
          isGoogleUser: true
        },
        token
      }
    });
  } catch (error) {
    console.error('Google success handler error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Handle failed Google authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const googleFailure = async (req, res) => {
  try {
    res.status(401).json({
      success: false,
      message: 'Google authentication failed',
      error: 'Authentication was not successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Google authentication error',
      error: error.message
    });
  }
};

/**
 * Link Google account to existing user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const linkGoogleAccount = async (req, res) => {
  try {
    const { idToken } = req.body;
    const userId = req.user.id; // From auth middleware

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required'
      });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const {
      sub: googleId,
      email,
      name: fullName,
      picture: avatar,
      email_verified: emailVerified
    } = payload;

    if (!emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Google email is not verified'
      });
    }

    // Only allow Gmail addresses
    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({
        success: false,
        message: 'Only Gmail addresses are allowed for Google login'
      });
    }

    // Check if Google account is already linked to another user
    const existingGoogleUser = await User.findOne({ googleId });
    if (existingGoogleUser && existingGoogleUser._id.toString() !== userId) {
      return res.status(409).json({
        success: false,
        message: 'This Google account is already linked to another user'
      });
    }

    // Get current user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Link Google account
    user.googleId = googleId;
    if (!user.avatar && avatar) {
      user.avatar = avatar;
    }
    
    // If user's identifier is not the Google email, keep the current identifier
    // but mark as verified since Google email is verified
    user.identifierVerified = true;
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Google account linked successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          isGoogleLinked: true
        }
      }
    });
  } catch (error) {
    console.error('Link Google account error:', error);
    
    if (error.message.includes('Token used too early') || 
        error.message.includes('Token used too late') ||
        error.message.includes('Invalid token signature')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to link Google account',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Unlink Google account from user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const unlinkGoogleAccount = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware

    // Get current user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has Google account linked
    if (!user.googleId) {
      return res.status(400).json({
        success: false,
        message: 'No Google account is linked to this user'
      });
    }

    // Ensure user has alternative login method (verified identifier)
    if (!user.identifierVerified) {
      return res.status(400).json({
        success: false,
        message: 'Cannot unlink Google account. Please verify your email or phone number first to ensure you can still access your account.'
      });
    }

    // Remove Google account data
    user.googleId = undefined;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Google account unlinked successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          isGoogleLinked: false
        }
      }
    });
  } catch (error) {
    console.error('Unlink Google account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlink Google account',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Complete Google OAuth registration with additional info
 * @route POST /api/auth/google/complete
 */
const completeGoogleAuth = async (req, res) => {
  console.log("jekko")
  try {
    const { tempId, ageGroup } = req.body;

    if (!tempId || !ageGroup) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: tempId and age group'
      });
    }

    // Get Google data from session
    if (!req.session.tempGoogleData || req.session.tempGoogleData.tempId !== tempId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired temporary session data'
      });
    }

    const { googleId, fullName, email, avatar } = req.session.tempGoogleData;

    // Check if user already exists
    let user = await User.findOne({ 
      $or: [{ googleId }, { identifier: email }] 
    });

    if (user && user.googleId === googleId) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this Google account'
      });
    }

    if (user && user.identifier === email) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user with complete information
    const newUser = new User({
      googleId,
      fullName,
      identifier: email,
      identifierType: 'email',
      ageGroup,
      avatar,
      identifierVerified: true, // Google emails are verified
      registrationStep: 'completed',
      lastLogin: new Date(),
      LastActive: new Date()
    });

    await newUser.save();

    // Generate JWT token
    const token = newUser.generateAuthToken();

    // Clear session data
    delete req.session.tempGoogleData;

    res.status(201).json({
      success: true,
      message: 'Google OAuth registration completed successfully',
      token,
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        identifier: newUser.identifier,
        identifierType: newUser.identifierType,
        ageGroup: newUser.ageGroup,
        avatar: newUser.avatar,
        identifierVerified: newUser.identifierVerified,
        registrationStep: newUser.registrationStep
      }
    });

  } catch (error) {
    console.error('Complete Google OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during Google OAuth completion'
    });
  }
};

module.exports = {
  googleAuth,
  googleLogin,
  googleCallback,
  getGoogleAuthURL,
  googleSuccess,
  googleFailure,
  linkGoogleAccount,
  unlinkGoogleAccount,
  completeGoogleAuth
};
