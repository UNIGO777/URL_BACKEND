/**
 * React Native Google OAuth Controller
 * Handles Google OAuth authentication specifically for React Native applications
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const { ensureDefaultLinksForUser } = require('../utils/helpers');

// Initialize Google OAuth client for Web (for web testing)
const googleMobileClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

/**
 * React Native Google OAuth login with ID token
 * Optimized for React Native apps using expo-auth-session or similar
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const reactNativeGoogleLogin = async (req, res) => {
  try {
    const { idToken, accessToken } = req.body;

    if (!idToken && !accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token or access token is required'
      });
    }

    let payload;

    if (idToken) {
      // Verify Google ID token using web client
      const ticket = await googleMobileClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else if (accessToken) {
      // For access token, fetch user info from Google API
      const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
      if (!response.ok) {
        throw new Error('Failed to fetch user info from Google');
      }
      const userInfo = await response.json();
      payload = {
        sub: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        email_verified: userInfo.verified_email
      };
    }

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
        // For new users, we need age group - return a special response
        return res.status(200).json({
          success: true,
          requiresAgeGroup: true,
          message: 'New user detected. Age group required to complete registration.',
          data: {
            tempUserData: {
              googleId,
              email: email.toLowerCase(),
              fullName,
              avatar,
              identifierVerified: true
            }
          }
        });
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
          identifierType: user.identifierType || 'email',
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
    console.error('React Native Google login error:', error);
    
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
 * Complete React Native Google registration with age group
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const completeReactNativeGoogleRegistration = async (req, res) => {
  try {
    const { tempUserData, ageGroup } = req.body;

    if (!tempUserData || !ageGroup) {
      return res.status(400).json({
        success: false,
        message: 'Temporary user data and age group are required'
      });
    }

    const { googleId, email, fullName, avatar } = tempUserData;

    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { googleId },
        { identifier: email.toLowerCase() }
      ]
    });

    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Create new user
    user = new User({
      fullName,
      identifier: email.toLowerCase(),
      identifierType: 'email',
      googleId,
      avatar,
      ageGroup,
      identifierVerified: true,
      registrationStep: 'completed'
    });

    await user.save();
    await ensureDefaultLinksForUser(user._id);

    // Generate JWT token
    const token = user.generateAuthToken();
    
    // Update last login
    user.lastLogin = new Date();
    user.LastActive = new Date();
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Google registration completed successfully',
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
        isNewUser: true
      }
    });

  } catch (error) {
    console.error('React Native Google registration completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration completion failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Get Google OAuth configuration for React Native
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getReactNativeGoogleConfig = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        clientId: process.env.GOOGLE_CLIENT_ID, // Use Web OAuth client for web testing
        // Add any other configuration needed for React Native
        scopes: ['openid', 'profile', 'email'],
        responseType: 'token', // Use implicit flow for React Native
        redirectUri: 'myapp://oauth/callback', // Use app's native scheme
        // Additional mobile-specific configuration
        platform: 'mobile',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token'
      }
    });
  } catch (error) {
    console.error('Get React Native Google config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Google configuration'
    });
  }
};

module.exports = {
  reactNativeGoogleLogin,
  completeReactNativeGoogleRegistration,
  getReactNativeGoogleConfig
};
