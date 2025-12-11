const express = require('express');
const router = express.Router();
const favsController = require('../controllers/favsController');
const { authenticate } = require('../middleware/auth');

/**
 * Favs Routes
 * Base path: /api/favs
 * All routes are user-specific and require authentication
 */

// ==================== Favorite Operations ====================

/**
 * @route   POST /api/favs
 * @desc    Add a link to user's favourites
 * @access  Private
 * @body    { linkId }
 */
router.post('/', authenticate, favsController.addToFavourites);

/**
 * @route   GET /api/favs
 * @desc    Get user's favorite links with pagination
 * @access  Private
 * @query   { page, limit }
 * @default page=1, limit=10
 */
router.get('/', authenticate, favsController.getFavoriteLinks);

/**
 * @route   DELETE /api/favs/:linkId
 * @desc    Remove a link from user's favourites
 * @access  Private
 * @param   linkId - The ID of the link to remove from favourites
 */
router.delete('/:linkId', authenticate, favsController.removeFromFavourites);

/**
 * @route   GET /api/favs/check/:linkId
 * @desc    Check if a link is favorited by the user
 * @access  Private
 * @param   linkId - The ID of the link to check
 */
router.get('/check/:linkId', authenticate, favsController.checkIfFavorited);

/**
 * @route   GET /api/favs/stats
 * @desc    Get user's favorite statistics
 * @access  Private
 */
router.get('/stats', authenticate, favsController.getFavouritestats);

module.exports = router;