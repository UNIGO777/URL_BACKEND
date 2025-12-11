const Fav = require('../models/Favs');
const Link = require('../models/Links');
const mongoose = require('mongoose');

/**
 * Favs Controller - Handle all favorite link operations
 * All operations are user-specific and require authentication
 */
class FavsController {

  /**
   * Add a link to favourites
   * POST /api/favs
   */
  async addToFavourites(req, res) {
    try {
      const { linkId } = req.body;
      const userId = req.user.id;

      // Validate required fields
      if (!linkId) {
        return res.status(400).json({
          success: false,
          message: 'Link ID is required'
        });
      }

      // Validate linkId format
      if (!mongoose.Types.ObjectId.isValid(linkId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID format'
        });
      }

      // Check if the link exists
      const link = await Link.findById(linkId);
      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      // Check if already favorited
      const existingFav = await Fav.findOne({ userId, linkId });
      if (existingFav) {
        return res.status(409).json({
          success: false,
          message: 'Link is already in favourites',
          data: existingFav
        });
      }

      // Create new favorite
      const newFav = new Fav({
        userId,
        linkId
      });

      const savedFav = await newFav.save();
      
      // Populate the link details for response
      await savedFav.populate('linkId');

      // Also reflect favorite status on the Link document
      try {
        await Link.findByIdAndUpdate(
          linkId,
          { $set: { isFavorite: true } },
          { new: true }
        );
      } catch (e) {
        // Log but don't fail the request if the link update fails
        console.warn('Failed to update Link.isFavorite=true:', e?.message || e);
      }

      res.status(201).json({
        success: true,
        message: 'Link added to favourites successfully',
        data: savedFav
      });

    } catch (error) {
      console.error('Error adding to favourites:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Remove a link from favourites
   * DELETE /api/favs/:linkId
   */
  async removeFromFavourites(req, res) {
    try {
      const { linkId } = req.params;
      const userId = req.user.id;

      // Validate linkId format
      if (!mongoose.Types.ObjectId.isValid(linkId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID format'
        });
      }

      // Find and remove the favorite
      const deletedFav = await Fav.findOneAndDelete({ userId, linkId });

      if (!deletedFav) {
        return res.status(404).json({
          success: false,
          message: 'Favorite not found or already removed'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Link removed from favourites successfully',
        data: { linkId, removedAt: new Date() }
      });

      // If no favourites remain for this link, unset favorite flag on the Link
      try {
        const remaining = await Fav.countDocuments({ linkId });
        if (remaining === 0) {
          await Link.findByIdAndUpdate(
            linkId,
            { $set: { isFavorite: false } },
            { new: true }
          );
        }
      } catch (e) {
        console.warn('Failed to update Link.isFavorite=false:', e?.message || e);
      }

    } catch (error) {
      console.error('Error removing from favourites:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get user's favorite links with pagination
   * GET /api/favs?page=1&limit=10
   */
  async getFavoriteLinks(req, res) {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Validate pagination parameters
      if (page < 1 || limit < 1 || limit > 50) {
        return res.status(400).json({
          success: false,
          message: 'Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 50'
        });
      }

      // Get total count for pagination info
      const totalFavourites = await Fav.countDocuments({ userId });

      // Get paginated favourites with populated link details
      const favourites = await Fav.find({ userId })
        .populate({
          path: 'linkId',
          select: 'url originalUrl linkType title description images metadata tags notes createdAt updatedAt'
        })
        .sort({ favoritedAt: -1 })
        .skip(skip)
        .limit(limit);

      // Calculate pagination info
      const totalPages = Math.ceil(totalFavourites / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      res.status(200).json({
        success: true,
        message: 'Favorite links retrieved successfully',
        data: {
          favourites,
          pagination: {
            currentPage: page,
            totalPages,
            totalFavourites,
            limit,
            hasNextPage,
            hasPrevPage,
            nextPage: hasNextPage ? page + 1 : null,
            prevPage: hasPrevPage ? page - 1 : null
          }
        }
      });

    } catch (error) {
      console.error('Error getting favorite links:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Check if a link is favorited by the user
   * GET /api/favs/check/:linkId
   */
  async checkIfFavorited(req, res) {
    try {
      const { linkId } = req.params;
      const userId = req.user.id;

      // Validate linkId format
      if (!mongoose.Types.ObjectId.isValid(linkId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid link ID format'
        });
      }

      const favorite = await Fav.findOne({ userId, linkId });

      res.status(200).json({
        success: true,
        data: {
          isFavorited: !!favorite,
          favoriteId: favorite ? favorite._id : null,
          favoritedAt: favorite ? favorite.favoritedAt : null
        }
      });

    } catch (error) {
      console.error('Error checking favorite status:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get user's favorite statistics
   * GET /api/favs/stats
   */
  async getFavouritestats(req, res) {
    try {
      const userId = req.user.id;

      const stats = await Fav.getUserStats(userId);

      res.status(200).json({
        success: true,
        message: 'Favorite statistics retrieved successfully',
        data: stats[0] || {
          totalFavourites: 0,
          oldestFavorite: null,
          newestFavorite: null
        }
      });

    } catch (error) {
      console.error('Error getting favorite stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = new FavsController();