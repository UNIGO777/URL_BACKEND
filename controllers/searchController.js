const Link = require('../models/Links');
const Fav = require('../models/Favs');

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRegex = (s) => new RegExp(escapeRegExp(String(s)), 'i');

class SearchController {
    /**
     * Search through user's links
     * Searches in: title, description, tags, url, domain
     */
    static async searchLinks(req, res) {
        try {
            const { page = 1, limit = 10 } = req.query;
            const userId = req.user.id;
            const rawQuery = String(req.query?.query ?? req.query?.q ?? '').trim();
            const rawTag = String(req.query?.tag ?? req.query?.tags ?? '').trim();

            if (!rawQuery && !rawTag) {
                return res.status(400).json({
                    success: false,
                    message: 'Provide a search query or a tag'
                });
            }

            const searchQuery = rawQuery;
            const skip = (parseInt(page) - 1) * parseInt(limit);

            // Base conditions - only for the authenticated user's links
            const searchConditions = {
                userId: userId,
                isActive: true
            };
            if (searchQuery.length > 0) {
                searchConditions.$or = [
                    { title: { $regex: toRegex(searchQuery) } },
                    { description: { $regex: toRegex(searchQuery) } },
                    { url: { $regex: toRegex(searchQuery) } },
                    { originalUrl: { $regex: toRegex(searchQuery) } },
                    { 'metadata.domain': { $regex: toRegex(searchQuery) } },
                    { tags: { $in: [toRegex(searchQuery)] } },
                    { notes: { $regex: toRegex(searchQuery) } }
                ];
            }

            // Optional filter: treat 'tag' as either linkType or a tag keyword
            if (rawTag && rawTag.length > 0) {
                const tagLower = rawTag.toLowerCase();
                const knownTypes = new Set(['social', 'product', 'news', 'video', 'portfolio', 'blog', 'education', 'forum', 'other']);
                if (knownTypes.has(tagLower)) {
                    searchConditions.linkType = tagLower;
                } else {
                    const tagList = rawTag.split(',').map(t => t.trim()).filter(t => t.length > 0);
                    const tagRegexes = tagList.map(t => toRegex(t));
                    searchConditions.tags = { $in: tagRegexes };
                }
            }

            // Execute search with pagination
            const [links, totalCount] = await Promise.all([
                Link.find(searchConditions)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .lean(),
                Link.countDocuments(searchConditions)
            ]);

            const totalPages = Math.ceil(totalCount / parseInt(limit));

            res.status(200).json({
                success: true,
                data: {
                    links,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages,
                        totalCount,
                        hasNextPage: parseInt(page) < totalPages,
                        hasPrevPage: parseInt(page) > 1
                    }
                },
                message: `Found ${totalCount} links matching "${searchQuery}"${rawTag ? ` with filter '${rawTag}'` : ''}`
            });

        } catch (error) {
            console.error('Search links error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to search links',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Search through user's favorite links
     * Searches in the linked content: title, description, tags, url, domain
     */
    static async searchFavorites(req, res) {
        try {
            const { query, page = 1, limit = 10 } = req.query;
            const userId = req.user.id;

            if (!query || query.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Search query is required'
                });
            }

            const searchQuery = query.trim();
            const skip = (parseInt(page) - 1) * parseInt(limit);

            // First, find user's favorites and populate the link details
            const favoritesAggregation = [
                // Match only user's favorites
                {
                    $match: { userId: userId }
                },
                // Lookup the link details
                {
                    $lookup: {
                        from: 'links',
                        localField: 'linkId',
                        foreignField: '_id',
                        as: 'linkDetails'
                    }
                },
                // Unwind the link details
                {
                    $unwind: '$linkDetails'
                },
                // Filter only active links and apply search conditions
                {
                    $match: {
                        'linkDetails.isActive': true,
                        'linkDetails.userId': userId, // Double ensure only user's own links
                        $or: [
                            { 'linkDetails.title': { $regex: toRegex(searchQuery) } },
                            { 'linkDetails.description': { $regex: toRegex(searchQuery) } },
                            { 'linkDetails.url': { $regex: toRegex(searchQuery) } },
                            { 'linkDetails.originalUrl': { $regex: toRegex(searchQuery) } },
                            { 'linkDetails.metadata.domain': { $regex: toRegex(searchQuery) } },
                            { 'linkDetails.tags': { $in: [toRegex(searchQuery)] } },
                            { 'linkDetails.notes': { $regex: toRegex(searchQuery) } }
                        ]
                    }
                },
                // Sort by favorite date (most recent first)
                {
                    $sort: { favoritedAt: -1 }
                }
            ];

            // Get total count
            const totalCountResult = await Fav.aggregate([
                ...favoritesAggregation,
                { $count: 'total' }
            ]);

            const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;

            // Get paginated results
            const favorites = await Fav.aggregate([
                ...favoritesAggregation,
                { $skip: skip },
                { $limit: parseInt(limit) },
                // Project the final structure
                {
                    $project: {
                        _id: 1,
                        userId: 1,
                        linkId: 1,
                        favoritedAt: 1,
                        createdAt: 1,
                        updatedAt: 1,
                        link: '$linkDetails'
                    }
                }
            ]);

            const totalPages = Math.ceil(totalCount / parseInt(limit));

            res.status(200).json({
                success: true,
                data: {
                    favorites,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages,
                        totalCount,
                        hasNextPage: parseInt(page) < totalPages,
                        hasPrevPage: parseInt(page) > 1
                    }
                },
                message: `Found ${totalCount} favorite links matching "${searchQuery}"`
            });

        } catch (error) {
            console.error('Search favorites error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to search favorites',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Combined search - search both links and favorites
     */
    static async searchAll(req, res) {
        try {
            const { query, page = 1, limit = 10, type = 'all' } = req.query;
            const userId = req.user.id;

            if (!query || query.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Search query is required'
                });
            }

            const results = {};

            // Search links if requested
            if (type === 'all' || type === 'links') {
                const linksReq = { ...req, query: { ...req.query, limit: type === 'links' ? limit : Math.ceil(limit / 2) } };
                const linksRes = {
                    status: () => ({ json: (data) => { results.links = data; } })
                };
                await SearchController.searchLinks(linksReq, linksRes);
            }

            // Search favorites if requested
            if (type === 'all' || type === 'favorites') {
                const favsReq = { ...req, query: { ...req.query, limit: type === 'favorites' ? limit : Math.ceil(limit / 2) } };
                const favsRes = {
                    status: () => ({ json: (data) => { results.favorites = data; } })
                };
                await SearchController.searchFavorites(favsReq, favsRes);
            }

            res.status(200).json({
                success: true,
                data: results,
                message: `Search completed for "${query.trim()}"`
            });

        } catch (error) {
            console.error('Combined search error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to perform search',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Search by specific tag
     */
    static async searchByTag(req, res) {
        try {
            const { tag, page = 1, limit = 10, type = 'links' } = req.query;
            const userId = req.user.id;

            if (!tag || tag.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Tag is required'
                });
            }

            const tagQuery = tag.trim();
            const skip = (parseInt(page) - 1) * parseInt(limit);

            if (type === 'links') {
                // Search in user's links by tag
                const searchConditions = {
                    userId: userId,
                    isActive: true,
                    tags: { $in: [toRegex(tagQuery)] }
                };

                const [links, totalCount] = await Promise.all([
                    Link.find(searchConditions)
                        .sort({ createdAt: -1 })
                        .skip(skip)
                        .limit(parseInt(limit))
                        .lean(),
                    Link.countDocuments(searchConditions)
                ]);

                const totalPages = Math.ceil(totalCount / parseInt(limit));

                res.status(200).json({
                    success: true,
                    data: {
                        links,
                        pagination: {
                            currentPage: parseInt(page),
                            totalPages,
                            totalCount,
                            hasNextPage: parseInt(page) < totalPages,
                            hasPrevPage: parseInt(page) > 1
                        }
                    },
                    message: `Found ${totalCount} links with tag "${tagQuery}"`
                });

            } else if (type === 'favorites') {
                // Search in user's favorites by tag
                const favorites = await Fav.aggregate([
                    { $match: { userId: userId } },
                    {
                        $lookup: {
                            from: 'links',
                            localField: 'linkId',
                            foreignField: '_id',
                            as: 'linkDetails'
                        }
                    },
                    { $unwind: '$linkDetails' },
                    {
                        $match: {
                            'linkDetails.isActive': true,
                            'linkDetails.userId': userId,
                            'linkDetails.tags': { $in: [toRegex(tagQuery)] }
                        }
                    },
                    { $sort: { favoritedAt: -1 } },
                    { $skip: skip },
                    { $limit: parseInt(limit) },
                    {
                        $project: {
                            _id: 1,
                            userId: 1,
                            linkId: 1,
                            favoritedAt: 1,
                            createdAt: 1,
                            updatedAt: 1,
                            link: '$linkDetails'
                        }
                    }
                ]);

                const totalCountResult = await Fav.aggregate([
                    { $match: { userId: userId } },
                    {
                        $lookup: {
                            from: 'links',
                            localField: 'linkId',
                            foreignField: '_id',
                            as: 'linkDetails'
                        }
                    },
                    { $unwind: '$linkDetails' },
                    {
                        $match: {
                            'linkDetails.isActive': true,
                            'linkDetails.userId': userId,
                            'linkDetails.tags': { $in: [toRegex(tagQuery)] }
                        }
                    },
                    { $count: 'total' }
                ]);

                const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;
                const totalPages = Math.ceil(totalCount / parseInt(limit));

                res.status(200).json({
                    success: true,
                    data: {
                        favorites,
                        pagination: {
                            currentPage: parseInt(page),
                            totalPages,
                            totalCount,
                            hasNextPage: parseInt(page) < totalPages,
                            hasPrevPage: parseInt(page) > 1
                        }
                    },
                    message: `Found ${totalCount} favorite links with tag "${tagQuery}"`
                });
            }

        } catch (error) {
            console.error('Search by tag error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to search by tag',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

module.exports = SearchController;
