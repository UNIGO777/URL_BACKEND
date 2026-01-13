/**
 * Authentication Controller
 * Handles user authentication operations like login, register, logout, password reset
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { sendOTPEmail } = require('../utils/emailService');
const { sendOTPSMS, validatePhoneNumber } = require('../utils/smsService');


/**
 * Register a new user with OTP verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const register = async (req, res) => {
  try {
    const { fullName, identifier, ageGroup, identifierType } = req.body;

    // Validate required fields
    if (!fullName || !ageGroup || !identifier || !identifierType) {
      return res.status(400).json({
        success: false,
        message: 'Full name, identifier (email or phone), identifierType, and age group are required'
      });
    }

    // Determine if identifier is email or phone
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    const isEmail = emailRegex.test(identifier);
    const isPhone = phoneRegex.test(identifier);

    if (!isEmail && !isPhone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address or phone number'
      });
    }

    // Validate phone number format if it's a phone
    if (isPhone && !validatePhoneNumber(identifier)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ identifier: identifier.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this identifier'
      });
    }

    // Create new user (not verified yet)
    const userData = {
      fullName: fullName.trim(),
      identifier: identifier.toLowerCase().trim(),
      identifierType,
      ageGroup,
      registrationStep: 'pending_verification'
    };

    const user = new User(userData);
    await user.save();

    // Generate and send OTP based on identifier type
    const otp = await OTP.createOTP(identifier, 'registration');
    let otpSent = false;
    let otpType = user.identifierType;

    

    if (user.identifierType === 'email') {
      otpSent = await sendOTPEmail(identifier, otp, 'registration');
    } else if (user.identifierType === 'phone') {
      otpSent = await sendOTPSMS(identifier, otp, 'registration');
    }

    // Check if OTP was sent successfully
    if (!otpSent) {
      // If OTP could not be sent, delete the user and return error
      await User.findByIdAndDelete(user._id);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.'
      });
    }

    res.status(201).json({
      success: true,
      message: `Registration initiated. Please verify your account with the OTP sent to your ${otpType}.`,
      data: {
        userId: user._id,
        identifierType: user.identifierType,
        otpSent: otpSent
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Verify OTP for registration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyOTP = async (req, res) => {
  try {
    const { identifier, otp, type = 'registration' } = req.body;

    console.log('Request Body:', req.body , identifier, otp, type);

    // Validate input
    if (!identifier || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Identifier and OTP are required'
      });
    }

    const allowedTypes = new Set(['registration', 'login', 'password_reset', 'email_verification', 'identifier_change']);
    const requestedType = typeof type === 'string' ? type : '';
    const otpType = allowedTypes.has(requestedType) ? requestedType : 'registration';

    // Verify OTP
    const isValidOTP = await OTP.verifyOTP(identifier, otp, otpType);

    if (!isValidOTP.success) {
      return res.status(400).json({
        success: false,
        message: isValidOTP.message || 'Invalid or expired OTP'
      });
    }

    // Find user
    const user = await User.findOne({ identifier: identifier.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update verification status
    user.identifierVerified = true;

    // Complete registration for verified users
    if (otpType === 'registration') {
      user.registrationStep = 'completed';
    }

    await user.save();

    // Generate JWT token for verified users
    let token = null;
    if (user.registrationStep === 'completed') {
      token = user.generateAuthToken();
      user.lastLogin = new Date();
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: user.registrationStep === 'completed' 
        ? 'Registration completed successfully' 
        : 'Verification successful.',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          identifierVerified: user.identifierVerified,
          registrationStep: user.registrationStep
        },
        token
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Resend OTP
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const resendOTP = async (req, res) => {
  try {
    const { identifier, type = 'registration' } = req.body;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Identifier is required'
      });
    }

    // Check if user exists
    const user = await User.findOne({ identifier: identifier.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const allowedTypes = new Set(['registration', 'login', 'password_reset', 'email_verification', 'identifier_change']);
    const requestedType = typeof type === 'string' ? type : '';
    const otpType = allowedTypes.has(requestedType) ? requestedType : 'registration';

    // Generate new OTP
    const newOTP = await OTP.createOTP(identifier, otpType);
    
    // Send OTP based on identifier type
    let sent = false;

    if (user.identifierType === 'email') {
      sent = await sendOTPEmail(identifier, newOTP, otpType);
    } else if (user.identifierType === 'phone') {
      sent = await sendOTPSMS(identifier, newOTP, otpType);
    }

    if (!sent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }

    res.status(200).json({
      success: true,
      message: `OTP sent successfully to your ${user.identifierType}`,
      data: {
        identifier,
        type: user.identifierType
      }
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Request login OTP
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const requestLoginOTP = async (req, res) => {
  try {
    const { identifier } = req.body; // email or phone

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    // First, try to find a verified user
    let user = await User.findOne({ 
      identifier: identifier.toLowerCase().trim(),
      identifierVerified: true,
      registrationStep: 'completed'
    });

    let otpType = 'login';
    let message = '';

    // If no verified user found, check for unverified user
    if (!user) {
      user = await User.findOne({ 
        identifier: identifier.toLowerCase().trim()
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found with this email or phone number, please sign up'
        });
      }

      // User exists but not verified, send verification OTP
      otpType = 'registration';
      message = `Account found but not verified. Verification OTP sent to your ${user.identifierType}`;
    } else {
      message = `Login OTP sent to your ${user.identifierType}`;
    }

    // Generate OTP (login or verification based on user status)
    const otp = await OTP.createOTP(identifier, otpType);
    
    // Send OTP based on identifier type
    let sent = false;

    if (user.identifierType === 'email') {
      sent = await sendOTPEmail(identifier, otp, otpType);
    } else if (user.identifierType === 'phone') {
      sent = await sendOTPSMS(identifier, otp, otpType);
    }

    if (!sent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }

    res.status(200).json({
      success: true,
      message: message,
      data: {
        identifier,
        type: user.identifierType,
        otpType: otpType, // 'login' for verified users, 'registration' for unverified
        userVerified: user.identifierVerified
      }
    });

  } catch (error) {
    console.error('Request login OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Verify login OTP and authenticate user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyLoginOTP = async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Identifier and OTP are required'
      });
    }

    // First, find the user (verified or unverified)
    let user = await User.findOne({ 
      identifier: identifier.toLowerCase().trim()
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Determine OTP type based on user verification status
    const otpType = user.identifierVerified ? 'login' : 'registration';

    // Verify OTP
    const isValidOTP = await OTP.verifyOTP(identifier, otp, otpType);
    
    if (!isValidOTP.success) {
      return res.status(400).json({
        success: false,
        message: isValidOTP.message || 'Invalid or expired OTP'
      });
    }

    // If user was unverified, complete the verification process
    if (!user.identifierVerified) {
      user.identifierVerified = true;
      user.registrationStep = 'completed';
      user.verifiedAt = new Date();
    }

    // Generate JWT token
    const token = user.generateAuthToken();
    
    // Update last login
    user.lastLogin = new Date();
    user.LastActive = new Date();
    await user.save();

    const message = user.identifierVerified && otpType === 'registration' 
      ? 'Account verified and login successful' 
      : 'Login successful';

    res.status(200).json({
      success: true,
      message: message,
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          identifier: user.identifier,
          identifierType: user.identifierType,
          ageGroup: user.ageGroup,
          avatar: user.avatar,
          identifierVerified: user.identifierVerified,
          lastLogin: user.lastLogin
        },
        token
      }
    });

  } catch (error) {
    console.error('Login OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

/**
 * Traditional login (for backward compatibility)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const login = async (req, res) => {
  try {
    // For now, redirect to OTP-based login
    return requestLoginOTP(req, res);
    // 2. Find user by email
    // 3. Compare password
    // 4. Generate JWT token
    // 5. Return user data and token
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        // user data and token will be returned here
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

/**
 * Logout user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const logout = async (req, res) => {
  try {
    // TODO: Implement logout logic
    // 1. Invalidate token (if using token blacklist)
    // 2. Clear any session data
    
    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
};

/**
 * Request password reset
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const forgotPassword = async (req, res) => {
  try {
    // TODO: Implement forgot password logic
    // 1. Validate email
    // 2. Find user by email
    // 3. Generate reset token
    // 4. Save reset token to user
    // 5. Send reset email
    
    res.status(200).json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Password reset request failed',
      error: error.message
    });
  }
};

/**
 * Reset password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const resetPassword = async (req, res) => {
  try {
    // TODO: Implement reset password logic
    // 1. Validate reset token
    // 2. Find user by reset token
    // 3. Check token expiry
    // 4. Hash new password
    // 5. Update user password
    // 6. Clear reset token
    
    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: error.message
    });
  }
};

/**
 * Verify email address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const verifyEmail = async (req, res) => {
  try {
    // TODO: Implement email verification logic
    // 1. Extract token from request
    // 2. Verify token
    // 3. Find user by token
    // 4. Mark email as verified
    // 5. Clear verification token
    
    res.status(200).json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Email verification failed',
      error: error.message
    });
  }
};





module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  verifyOTP,
  resendOTP,
  requestLoginOTP,
  verifyLoginOTP
};
