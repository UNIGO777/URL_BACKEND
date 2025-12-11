const express = require('express');
const router = express.Router();
const SearchController = require('../controllers/searchController');
const { authenticate } = require('../middleware/auth');

// All search routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/search/links
 * @desc    Search through user's links
 * @access  Private
 * @params  query (required), page (optional, default: 1), limit (optional, default: 10)
 */
router.get('/links', SearchController.searchLinks);

/**
 * @route   GET /api/search/favourites
 * @desc    Search through user's favorite links
 * @access  Private
 * @params  query (required), page (optional, default: 1), limit (optional, default: 10)
 */
router.get('/favourites', SearchController.searchFavourites);

/**
 * @route   GET /api/search/all
 * @desc    Search through both links and favourites
 * @access  Private
 * @params  query (required), page (optional, default: 1), limit (optional, default: 10), type (optional: 'all', 'links', 'favourites')
 */
router.get('/all', SearchController.searchAll);

/**
 * @route   GET /api/search/tag
 * @desc    Search by specific tag in links or favourites
 * @access  Private
 * @params  tag (required), page (optional, default: 1), limit (optional, default: 10), type (optional: 'links', 'favourites')
 */
router.get('/tag', SearchController.searchByTag);

module.exports = router;