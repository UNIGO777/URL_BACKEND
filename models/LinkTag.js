const mongoose = require('mongoose');

const linkTagSchema = new mongoose.Schema({
  tagName: {
    type: String,
    trim: true,
    required: [true, 'Tag name is required'],
    maxlength: [50, 'Tag cannot exceed 50 characters']
  },
  linkId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Link',
    required: [true, 'Link ID is required'],
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  }
}, { timestamps: true });

linkTagSchema.index({ userId: 1, tagName: 1 });
linkTagSchema.index({ linkId: 1 });
linkTagSchema.index({ userId: 1, linkId: 1, tagName: 1 }, { unique: true });

module.exports = mongoose.model('LinkTag', linkTagSchema);
