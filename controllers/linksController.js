const Link = require('../models/Links');
const { normalizeUrl } = require('../utils/url');
const mongoose = require('mongoose');
const Fav = require('../models/Favs');

/**
 * Links Controller - Handle all link CRUD operations
 * All operations are user-specific (no public links)
 */
class LinksController {

  /**
   * Create a new link
   * POST /api/links
   */
  async createLink(req, res) {
    try {
      const {
        url,
        originalUrl,
        linkType = 'other',
        title,
        description,
        images = {},
        metadata = {},
        tags = [],
        notes
      } = req.body;

      const userId = req.user.id;

      // Validate required fields
      if (!url) {
        return res.status(400).json({
          success: false,
          message: 'URL is required'
        });
      }

      const normalizedUrl = normalizeUrl(url);
      const normalizedOriginalUrl = originalUrl ? normalizeUrl(originalUrl) : undefined;

      // Check if user already has this URL saved
      const existingLink = await Link.findOne({ 
        url: normalizedUrl, 
        userId: userId,
        isActive: true 
      });

      if (existingLink) {
        return res.status(409).json({
          success: false,
          message: 'You have already saved this link',
          data: existingLink
        });
      }

      // Create new link
      const linkData = {
        userId,
        url: normalizedUrl,
        originalUrl: normalizedOriginalUrl,
        isFavorite: req.body.isFavorite || false,
        linkType,
        title: title?.trim(),
        description: description?.trim(),
        images,
        metadata,
        tags: Array.from(new Set(tags.map(tag => tag.trim()))).filter(tag => tag.length > 0),
        tagsNormalized: Array.from(new Set(tags.map(tag => tag.trim().toLowerCase()))).filter(tag => tag.length > 0),
        notes: notes?.trim()
      };

      const newLink = new Link(linkData);
      let savedLink;
      try {
        savedLink = await newLink.save();
      } catch (err) {
        if (err && err.code === 11000) {
          return res.status(409).json({
            success: false,
            message: 'You have already saved this link'
          });
        }
        throw err;
      }

      // Populate user data
      await savedLink.populate('userId', 'fullName identifier');

      // If marked as favorite, create a favorite record
      if (savedLink.isFavorite) {
        try {
          await Fav.create({
            userId,
            linkId: savedLink._id
          });
        } catch (err) {
          // Ignore duplicate favorite errors
          if (!(err && err.code === 11000)) {
            console.error('❌ Error creating favorite record:', err.message);
          }
        }
      }

      console.log('✅ Link created successfully:', savedLink._id);

      res.status(201).json({
        success: true,
        message: 'Link saved successfully',
        data: savedLink
      });

    } catch (error) {
      console.error('❌ Error creating link:', error.message);
      
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to create link',
        error: error.message
      });
    }
  }

  /**
   * Get all links for a user with filtering and pagination
   * GET /api/links
   */
  async getUserLinks(req, res) {
    try {
      const userId = req.user.id;

      const {
        linkType,
        tags,
        search,
        page = 1,
        limit = 10,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build filter object
      const filter = { 
        userId: userId,
        isActive: true 
      };
      
      if (linkType && linkType !== 'all') {
        filter.linkType = linkType;
      }

      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : tags.split(',');
        filter.tags = { $in: tagArray.map(tag => tag.trim()) };
      }

      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { url: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ];
      }

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortObj = {};
      sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Get links with pagination
      const links = await Link.find(filter)
        .populate('userId', 'fullName identifier')
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit));

      // Get total count for pagination
      const totalCount = await Link.countDocuments(filter);
      const totalPages = Math.ceil(totalCount / parseInt(limit));

      res.json({
        success: true,
        data: links,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1,
          limit: parseInt(limit)
        }
      });

    } catch (error) {
      console.error('❌ Error getting user links:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to get links',
        error: error.message
      });
    }
  }

  /**
   * Get a single link by ID (user-specific)
   * GET /api/links/:id
   */
  async getLinkById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID'
        });
      }
      
      const link = await Link.findOne({ 
        _id: id, 
        userId: userId,
        isActive: true 
      }).populate('userId', 'fullName identifier');

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      res.json({
        success: true,
        data: link
      });

    } catch (error) {
      console.error('❌ Error getting link:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to get link',
        error: error.message
      });
    }
  }

  /**
   * Update a link (user-specific)
   * PUT /api/links/:id
   */
  async updateLink(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID'
        });
      }

      const updateData = { ...req.body };
      
      // Remove fields that shouldn't be updated directly
      delete updateData._id;
      delete updateData.userId;
      delete updateData.createdAt;
      delete updateData.updatedAt;
      delete updateData.analytics;

      // Clean tags array
      if (updateData.tags) {
        updateData.tags = Array.from(new Set(updateData.tags.map(tag => tag.trim()))).filter(tag => tag.length > 0);
        updateData.tagsNormalized = Array.from(new Set(updateData.tags.map(tag => tag.toLowerCase()))).filter(tag => tag.length > 0);
      }

      if (updateData.url) {
        updateData.url = normalizeUrl(updateData.url);
      }

      const updatedLink = await Link.findOneAndUpdate(
        { _id: id, userId: userId, isActive: true },
        updateData,
        { new: true, runValidators: true }
      ).populate('userId', 'fullName identifier');

      if (!updatedLink) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      console.log('✅ Link updated successfully:', updatedLink._id);

      res.json({
        success: true,
        message: 'Link updated successfully',
        data: updatedLink
      });

    } catch (error) {
      console.error('❌ Error updating link:', error.message);
      
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to update link',
        error: error.message
      });
    }
  }

  /**
   * Delete a link (soft delete, user-specific)
   * DELETE /api/links/:id
   */
  async deleteLink(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID'
        });
      }

      const deletedLink = await Link.findOneAndUpdate(
        { _id: id, userId: userId, isActive: true },
        { isActive: false },
        { new: true }
      );

      if (!deletedLink) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      console.log('✅ Link deleted successfully:', deletedLink._id);

      res.json({
        success: true,
        message: 'Link deleted successfully'
      });

    } catch (error) {
      console.error('❌ Error deleting link:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to delete link',
        error: error.message
      });
    }
  }

  /**
   * Get links by type for a user
   * GET /api/links/type/:type
   */
  async getLinksByType(req, res) {
    try {
      const { type } = req.params;
      const userId = req.user.id;
      const { limit = 10, page = 1 } = req.query;

      const validTypes = ['social', 'product', 'news', 'video', 'portfolio', 'blog', 'education', 'forum', 'other'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link type',
          validTypes
        });
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const links = await Link.find({ 
        linkType: type, 
        userId: userId,
        isActive: true 
      })
        .populate('userId', 'fullName identifier')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const totalCount = await Link.countDocuments({ 
        linkType: type, 
        userId: userId,
        isActive: true 
      });

      res.json({
        success: true,
        data: links,
        count: links.length,
        totalCount,
        type
      });

    } catch (error) {
      console.error('❌ Error getting links by type:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to get links by type',
        error: error.message
      });
    }
  }








}

module.exports = new LinksController();
