const express = require('express');
const router = express.Router();
const shareController = require('../controllers/shareController');

router.post('/', shareController.create.bind(shareController));
router.get('/:token', shareController.get.bind(shareController));

module.exports = router;
