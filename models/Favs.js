const mongoose = require('mongoose');

/**
 * Favs Schema - Store user favorite links
 * Each document represents a user's favorite link relationship
 */
const favsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required'],
        index: true
    },
    linkId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Link',
        required: [true, 'Link ID is required'],
        index: true
    },
    // Optional: Store additional metadata about when/why it was favorited
    favoritedAt: {
        type: Date,
        default: Date.now,
        index: true
    },

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ==================== INDEXES ====================

// Compound index to ensure a user can't favorite the same link twice
favsSchema.index({ userId: 1, linkId: 1 }, { unique: true });

// Index for efficient queries
favsSchema.index({ favoritedAt: -1 });

// ==================== VIRTUALS ====================

// Virtual to get the age of the favorite in days
favsSchema.virtual('daysSinceFavorited').get(function() {
    if (!this.favoritedAt) return 0;
    const now = new Date();
    const diffTime = Math.abs(now - this.favoritedAt);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// ==================== INSTANCE METHODS ====================

// No instance methods needed for the simplified Favs model

// ==================== STATIC METHODS ====================

/**
 * Find all favourites for a user
 */
favsSchema.statics.findByUser = function(userId, options = {}) {
    const query = { userId };
    
    return this.find(query)
        .populate('linkId')
        .sort(options.sort || { favoritedAt: -1 })
        .limit(options.limit || 0);
};

/**
 * Find all users who favorited a specific link
 */
favsSchema.statics.findByLink = function(linkId) {
    return this.find({ linkId })
        .populate('userId', 'fullName identifier')
        .sort({ favoritedAt: -1 });
};

/**
 * Check if a user has favorited a specific link
 */
favsSchema.statics.isFavorited = function(userId, linkId) {
    return this.findOne({ userId, linkId });
};

/**
 * Get favorite statistics for a user
 */
favsSchema.statics.getUserStats = function(userId) {
    return this.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: null,
                totalFavourites: { $sum: 1 },
                oldestFavorite: { $min: '$favoritedAt' },
                newestFavorite: { $max: '$favoritedAt' }
            }
        }
    ]);
};

/**
 * Get most favorited links across all users
 */
favsSchema.statics.getMostFavorited = function(limit = 10) {
    return this.aggregate([
        {
            $group: {
                _id: '$linkId',
                favoriteCount: { $sum: 1 },
                lastFavorited: { $max: '$favoritedAt' }
            }
        },
        { $sort: { favoriteCount: -1, lastFavorited: -1 } },
        { $limit: limit },
        {
            $lookup: {
                from: 'links',
                localField: '_id',
                foreignField: '_id',
                as: 'linkDetails'
            }
        },
        { $unwind: '$linkDetails' }
    ]);
};

// ==================== MIDDLEWARE ====================

// Pre-save middleware to validate that the link exists and belongs to the user
favsSchema.pre('save', async function(next) {
    if (this.isNew) {
        try {
            // Check if the link exists
            const Link = mongoose.model('Link');
            const link = await Link.findById(this.linkId);
            
            if (!link) {
                return next(new Error('Link not found'));
            }
            
            // Optionally: Check if the link belongs to the user (uncomment if needed)
            // if (link.userId.toString() !== this.userId.toString()) {
            //     return next(new Error('You can only favorite your own links'));
            // }
            
        } catch (error) {
            return next(error);
        }
    }
    next();
});



module.exports = mongoose.model('Fav', favsSchema);