/**
 * User Controller
 * Handles user profile and account management operations
 */

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Links = require('../models/Links');
const Favs = require('../models/Favs');
const LinkTag = require('../models/LinkTag');
const OTP = require('../models/OTP');
const { sendOTPEmail } = require('../utils/emailService');
const { sendOTPSMS, validatePhoneNumber } = require('../utils/smsService');

const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    id: user._id,
    fullName: user.fullName,
    identifier: user.identifier,
    identifierType: user.identifierType,
    ageGroup: user.ageGroup,
    avatar: user.avatar,
    identifierVerified: user.identifierVerified,
    registrationStep: user.registrationStep,
    lastLogin: user.lastLogin,
    LastActive: user.LastActive,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};

/**
 * Get user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: sanitizeUser(user)
      
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
};

/**
 * Update user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { fullName, ageGroup, avatar } = req.body || {};

    const updates = {};
    if (typeof fullName === 'string') updates.fullName = fullName;
    if (typeof ageGroup === 'string') updates.ageGroup = ageGroup;
    if (typeof avatar === 'string') updates.avatar = avatar;

    const updated = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: sanitizeUser(updated)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

/**
 * Change user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation do not match'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (typeof user.password !== 'string' || !user.password) {
      return res.status(400).json({
        success: false,
        message: 'Password-based authentication is not enabled for this account'
      });
    }

    const isMatch = await bcrypt.compare(currentPassword || '', user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    user.password = hashed;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
};

/**
 * Delete user account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { password } = req.body || {};
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (typeof user.password === 'string' && user.password) {
      const isMatch = await bcrypt.compare(password || '', user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect password'
        });
      }
    }

    await Promise.all([
      Links.deleteMany({ userId }),
      Favs.deleteMany({ userId }),
      LinkTag.deleteMany({ userId })
    ]);

    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    });
  }
};

/**
 * Get all users (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [total, users] = await Promise.all([
      User.countDocuments({}),
      User.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit)
    ]);

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users: users.map(sanitizeUser),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      error: error.message
    });
  }
};

/**
 * Get user by ID (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: {
        user: sanitizeUser(user)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user',
      error: error.message
    });
  }
};

/**
 * Update user status (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const allowed = ['active', 'inactive', 'suspended'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed values: active, inactive, suspended'
      });
    }

    const isActive = status === 'active';
    const updated = await User.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      data: {
        user: sanitizeUser(updated)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message
    });
  }
};

const requestIdentifierChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { newIdentifier } = req.body || {};
    if (!newIdentifier || typeof newIdentifier !== 'string') {
      return res.status(400).json({ success: false, message: 'New identifier is required' });
    }

    const identifier = newIdentifier.trim().toLowerCase();
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    const phoneRegex = /^[\+]?\d{7,16}$/;
    const isEmail = emailRegex.test(identifier);
    const isPhone = phoneRegex.test(identifier);

    if (!isEmail && !isPhone) {
      return res.status(400).json({ success: false, message: 'Provide a valid email or phone number' });
    }

    if (isPhone && !validatePhoneNumber(identifier)) {
      return res.status(400).json({ success: false, message: 'Provide a valid phone number' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.identifier === identifier) {
      return res.status(400).json({ success: false, message: 'New identifier must be different from current' });
    }

    const exists = await User.findOne({ identifier });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Identifier already in use' });
    }

    const otp = await OTP.createOTP(identifier, 'identifier_change');
    let sent = false;
    const targetType = isEmail ? 'email' : 'phone';
    if (isEmail) {
      sent = await sendOTPEmail(identifier, otp, 'identifier_change');
    } else {
      sent = await sendOTPSMS(identifier, otp, 'identifier_change');
    }

    if (!sent) {
      return res.status(500).json({ success: false, message: `Failed to send OTP to ${targetType}` });
    }

    return res.status(200).json({
      success: true,
      message: `OTP sent to your ${targetType}`,
      data: { newIdentifier: identifier, identifierType: targetType }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to request OTP', error: error.message });
  }
};

const verifyIdentifierChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { newIdentifier, otp } = req.body || {};
    if (!newIdentifier || !otp) {
      return res.status(400).json({ success: false, message: 'New identifier and OTP are required' });
    }

    const identifier = String(newIdentifier).trim().toLowerCase();

    const isValidOTP = await OTP.verifyOTP(identifier, String(otp), 'identifier_change');
    if (!isValidOTP.success) {
      return res.status(400).json({ success: false, message: isValidOTP.message || 'Invalid or expired OTP' });
    }

    const exists = await User.findOne({ identifier });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Identifier already in use' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.identifier = identifier;
    user.identifierVerified = true;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Identifier updated successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to verify OTP', error: error.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
  getAllUsers,
  getUserById,
  updateUserStatus,
  requestIdentifierChangeOTP,
  verifyIdentifierChangeOTP
};
