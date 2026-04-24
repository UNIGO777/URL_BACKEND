const mongoose = require('mongoose');

const { Schema } = mongoose;

const errorLogSchema = new Schema({
  source: {
    type: String,
    enum: ['request', 'startup', 'server', 'database', 'uncaughtException', 'unhandledRejection'],
    default: 'request',
    index: true
  },
  name: {
    type: String,
    trim: true,
    default: 'Error'
  },
  message: {
    type: String,
    required: [true, 'Error message is required'],
    trim: true
  },
  stack: {
    type: String
  },
  code: {
    type: String,
    trim: true
  },
  statusCode: {
    type: Number,
    min: 100,
    max: 599
  },
  request: {
    method: {
      type: String,
      trim: true
    },
    path: {
      type: String,
      trim: true
    },
    originalUrl: {
      type: String,
      trim: true
    },
    ip: {
      type: String,
      trim: true
    },
    userAgent: {
      type: String,
      trim: true
    },
    params: {
      type: Schema.Types.Mixed
    },
    query: {
      type: Schema.Types.Mixed
    },
    body: {
      type: Schema.Types.Mixed
    },
    headers: {
      type: Schema.Types.Mixed
    }
  },
  metadata: {
    type: Schema.Types.Mixed
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

errorLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.ErrorLog || mongoose.model('ErrorLog', errorLogSchema);
