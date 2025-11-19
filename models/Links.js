const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required'],
        index: true
    },
    url: {
        type: String,
        required: [true, 'URL is required'],
        trim: true,
        validate: {
            validator: function (value) {
                // Basic URL validation
                const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
                return urlRegex.test(value);
            },
            message: 'Please enter a valid URL'
        }
    },

    originalUrl: {
        type: String,
        trim: true,
        // Store the original URL before any redirects
    },
    linkType: {
        type: String,
        required: [true, 'Link type is required'],
        enum: {
            values: ['social', 'product', 'news', 'video', 'portfolio', 'blog', 'education', 'forum', 'other'],
            message: 'Please select a valid link type'
        },
        default: 'other'
    },
    title: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    images: {
        logo: {
            type: String,
            trim: true,
            validate: {
                validator: function (value) {
                    if (!value) return true; // Allow null/empty values
                    const urlRegex = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
                    return urlRegex.test(value);
                },
                message: 'Logo must be a valid URL'
            }
        },
        ogImage: {
            type: String,
            trim: true,
            validate: {
                validator: function (value) {
                    if (!value) return true; // Allow null/empty values
                    const urlRegex = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
                    return urlRegex.test(value);
                },
                message: 'OG Image must be a valid URL'
            }
        },
        favicon: {
            type: String,
            trim: true,
            validate: {
                validator: function (value) {
                    if (!value) return true; // Allow null/empty values
                    const urlRegex = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
                    return urlRegex.test(value);
                },
                message: 'Favicon must be a valid URL'
            }
        },
        appleTouchIcon: {
            type: String,
            trim: true,
            validate: {
                validator: function (value) {
                    if (!value) return true; // Allow null/empty values
                    const urlRegex = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
                    return urlRegex.test(value);
                },
                message: 'Apple Touch Icon must be a valid URL'
            }
        }
    },
    metadata: {
        domain: {
            type: String,
            trim: true
        },
        statusCode: {
            type: Number,
            min: [100, 'Status code must be at least 100'],
            max: [599, 'Status code must be at most 599']
        },
        statusText: {
            type: String,
            trim: true
        },
        method: {
            type: String,
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
            default: 'GET'
        },
        contentType: {
            type: String,
            trim: true
        },
        responseTime: {
            type: Number, // in milliseconds
            min: [0, 'Response time cannot be negative']
        },
        attempt: {
            type: Number,
            min: [1, 'Attempt must be at least 1'],
            default: 1
        }
    },
    analytics: {
        accessCount: {
            type: Number,
            default: 0,
            min: [0, 'Access count cannot be negative']
        },
        lastAccessed: {
            type: Date
        },
        firstAccessed: {
            type: Date,
            default: Date.now
        },
        uniqueVisitors: [{
            ip: String,
            userAgent: String,
            timestamp: {
                type: Date,
                default: Date.now
            }
        }]
    },
    tags: [{
        type: String,
        trim: true,
        maxlength: [50, 'Tag cannot exceed 50 characters']
    }],
    isFavorite: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters']
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
linkSchema.index({ url: 1 });
linkSchema.index({ linkType: 1 });
linkSchema.index({ userId: 1 });
linkSchema.index({ 'metadata.domain': 1 });
linkSchema.index({ createdAt: -1 });
linkSchema.index({ 'analytics.lastAccessed': -1 });
linkSchema.index({ userId: 1, url: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

// Virtual for getting domain from URL
linkSchema.virtual('domain').get(function () {
    if (!this.url) return null;
    try {
        const urlObj = new URL(this.url);
        return urlObj.hostname;
    } catch (error) {
        return null;
    }
});

// Virtual for checking if link has images
linkSchema.virtual('hasImages').get(function () {
    return !!(this.images.logo || this.images.ogImage || this.images.favicon || this.images.appleTouchIcon);
});

// Method to increment access count
linkSchema.methods.incrementAccess = function (visitorInfo = {}) {
    this.analytics.accessCount += 1;
    this.analytics.lastAccessed = new Date();

    // Add unique visitor if provided
    if (visitorInfo.ip) {
        const existingVisitor = this.analytics.uniqueVisitors.find(
            visitor => visitor.ip === visitorInfo.ip
        );

        if (!existingVisitor) {
            this.analytics.uniqueVisitors.push({
                ip: visitorInfo.ip,
                userAgent: visitorInfo.userAgent || '',
                timestamp: new Date()
            });
        }
    }

    return this.save();
};

// Static method to find links by type
linkSchema.statics.findByType = function (linkType) {
    return this.find({ linkType, isActive: true });
};

// Static method to find links by domain
linkSchema.statics.findByDomain = function (domain) {
    return this.find({ 'metadata.domain': domain, isActive: true });
};

// Static method to find popular links
linkSchema.statics.findPopular = function (limit = 10) {
    return this.find({ isActive: true })
        .sort({ 'analytics.accessCount': -1 })
        .limit(limit);
};

// Static method to find recent links
linkSchema.statics.findRecent = function (limit = 10) {
    return this.find({ isActive: true })
        .sort({ createdAt: -1 })
        .limit(limit);
};

// Pre-save middleware to extract domain
linkSchema.pre('save', function (next) {
    if (this.url && this.isModified('url')) {
        try {
            const urlObj = new URL(this.url);
            this.metadata.domain = urlObj.hostname;
        } catch (error) {
            // Invalid URL, domain will remain undefined
        }
    }
    next();
});

// Pre-save middleware to set first accessed time
linkSchema.pre('save', function (next) {
    if (this.isNew) {
        this.analytics.firstAccessed = new Date();
    }
    next();
});

module.exports = mongoose.model('Link', linkSchema);