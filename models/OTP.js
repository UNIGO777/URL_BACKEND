const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: [true, 'Email or phone is required'],
    trim: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: [true, 'OTP is required'],
    length: [4, 'OTP must be 4 digits']
  },
  type: {
    type: String,
    required: [true, 'OTP type is required'],
    enum: {
      values: ['registration', 'login', 'password_reset', 'email_verification', 'identifier_change'],
      message: 'Invalid OTP type'
    }
  },
  attempts: {
    type: Number,
    default: 0,
    max: [3, 'Maximum 3 attempts allowed']
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
  }
}, {
  timestamps: true
});

// Index for automatic deletion of expired documents
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for faster queries

otpSchema.index({ identifier: 1, type: 1 });

// Static method to generate OTP
otpSchema.statics.generateOTP = function() {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Static method to create and save OTP
otpSchema.statics.createOTP = async function(identifier, type) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  // Delete any existing OTP for this identifier and type
  await this.deleteMany({ identifier: normalizedIdentifier, type });
  
  const otp = this.generateOTP();
  const otpDoc = new this({
    identifier: normalizedIdentifier,
    otp: String(otp).trim(),
    type
  });
  
  await otpDoc.save();
  return otp;
};

// Static method to verify OTP
otpSchema.statics.verifyOTP = async function(identifier, otp, type) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  const normalizedOtp = String(otp || '').trim();
  const now = new Date();

  const baseQuery = {
    identifier: normalizedIdentifier,
    otp: normalizedOtp
  };

  const allowedFallbackTypes = new Set(['registration', 'login']);
  const shouldFallbackType = allowedFallbackTypes.has(type);
  const typeQuery = shouldFallbackType ? { $in: ['registration', 'login'] } : type;

  const otpDoc = await this.findOne({
    ...baseQuery,
    type: typeQuery,
    isUsed: false,
    expiresAt: { $gt: now }
  }).sort({ createdAt: -1 });

  if (!otpDoc) {
    const lastOtpDoc = await this.findOne({
      ...baseQuery,
      type: typeQuery
    }).sort({ createdAt: -1 });

    if (lastOtpDoc) {
      if (lastOtpDoc.isUsed) return { success: false, message: 'OTP already used. Please request a new OTP.' };
      if (lastOtpDoc.expiresAt && lastOtpDoc.expiresAt <= now) {
        return { success: false, message: 'OTP expired. Please request a new OTP.' };
      }
    }

    return { success: false, message: 'Invalid OTP' };
  }

  if (otpDoc.attempts >= 3) {
    return { success: false, message: 'Maximum attempts exceeded' };
  }

  // Mark as used
  otpDoc.isUsed = true;
  await otpDoc.save();

  return { success: true, message: 'OTP verified successfully' };
};

// Static method to increment attempts
otpSchema.statics.incrementAttempts = async function(identifier, type) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  await this.updateOne(
    { identifier: normalizedIdentifier, type, isUsed: false },
    { $inc: { attempts: 1 } }
  );
};

module.exports = mongoose.model('OTP', otpSchema);
