const Link = require('../models/Links');
const Fav = require('../models/Favs');
const LinkTag = require('../models/LinkTag');

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
            const q = String(req.query?.q ?? req.query?.query ?? '').trim();
            const tagsParam = String(req.query?.tags ?? req.query?.tag ?? '').trim();
            const typeParam = String(req.query?.type ?? '').trim();

            const knownTypes = new Set(['social', 'product', 'news', 'video', 'portfolio', 'blog', 'education', 'forum', 'other']);
            const tagParts = tagsParam ? tagsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
            const type = typeParam ? typeParam.toLowerCase() : (knownTypes.has(tagsParam.toLowerCase()) ? tagsParam.toLowerCase() : '');

            if (!q && !type && tagParts.length === 0) {
                return res.status(400).json({ success: false, message: 'Provide a search query, type, or tags' });
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const andConds = [ { userId, isActive: true } ];
            let tagLinkIds = [];

            if (q) {
                const rx = toRegex(q);
                const qLower = q.toLowerCase();
                try {
                    tagLinkIds = await LinkTag.find({ userId, tagName: qLower }).distinct('linkId');
                } catch (e) {}
                andConds.push({
                    $or: [
                        ...(tagLinkIds.length ? [{ _id: { $in: tagLinkIds } }] : []),
                        { title: { $regex: rx } },
                        { description: { $regex: rx } },
                        { url: { $regex: rx } },
                        { originalUrl: { $regex: rx } },
                        { 'metadata.domain': { $regex: rx } },
                        { notes: { $regex: rx } },
                        { tags: { $regex: rx } },
                        { tags: { $elemMatch: { $regex: rx } } },
                        { tagsNormalized: { $in: [qLower] } }
                    ]
                });
            }

            if (type) {
                andConds.push({ linkType: type });
            }

            if (tagParts.length > 0) {
                const lowers = tagParts.map(t => t.toLowerCase());
                try {
                    const ids = await LinkTag.find({ userId, tagName: { $in: lowers } }).distinct('linkId');
                    if (ids.length) {
                        andConds.push({ _id: { $in: ids } });
                    }
                } catch (e) {}
            }

            const searchConditions = andConds.length === 1 ? andConds[0] : { $and: andConds };

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
                message: `Found ${totalCount} links${q ? ` for "${q}"` : ''}${type ? ` in '${type}'` : ''}${tagParts.length ? ` with tags '${tagParts.join(',')}'` : ''}`
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
    static async searchFavourites(req, res) {
        try {
            const { page = 1, limit = 10 } = req.query;
            const userId = req.user.id;
            const q = String(req.query?.q ?? req.query?.query ?? '').trim();
            const tagsParam = String(req.query?.tags ?? req.query?.tag ?? '').trim();
            const typeParam = String(req.query?.type ?? '').trim();

            const knownTypes = new Set(['social', 'product', 'news', 'video', 'portfolio', 'blog', 'education', 'forum', 'other']);
            const tagParts = tagsParam ? tagsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
            const type = typeParam ? typeParam.toLowerCase() : (knownTypes.has(tagsParam.toLowerCase()) ? tagsParam.toLowerCase() : '');

            if (!q && !type && tagParts.length === 0) {
                return res.status(400).json({ success: false, message: 'Provide a search query, type, or tags' });
            }

            const rx = q ? toRegex(q) : null;
            const qLower = q ? q.toLowerCase() : null;
            const skip = (parseInt(page) - 1) * parseInt(limit);

            const favouritesAggregation = [
                { $match: { userId: userId } },
                { $lookup: { from: 'links', localField: 'linkId', foreignField: '_id', as: 'linkDetails' } },
                { $unwind: '$linkDetails' },
                { $match: { 'linkDetails.isActive': true, 'linkDetails.userId': userId } },
                { $match: (function() {
                    const andConds = [];
                    if (rx) {
                        andConds.push({ $or: [
                            { 'linkDetails.title': { $regex: rx } },
                            { 'linkDetails.description': { $regex: rx } },
                            { 'linkDetails.url': { $regex: rx } },
                            { 'linkDetails.originalUrl': { $regex: rx } },
                            { 'linkDetails.metadata.domain': { $regex: rx } },
                            { 'linkDetails.notes': { $regex: rx } },
                            { 'linkDetails.tags': { $regex: rx } },
                            { 'linkDetails.tags': { $elemMatch: { $regex: rx } } },
                            ...(qLower ? [{ 'linkDetails.tagsNormalized': { $in: [qLower] } }] : [])
                        ]});
                    }
                    if (type) {
                        andConds.push({ 'linkDetails.linkType': type });
                    }
                    if (tagParts.length > 0) {
                        const tagOr = tagParts.map(t => ({ $or: [
                            { 'linkDetails.tagsNormalized': { $in: [t.toLowerCase()] } },
                            { 'linkDetails.tags': { $regex: toRegex(t) } },
                            { 'linkDetails.tags': { $elemMatch: { $regex: toRegex(t) } } }
                        ] }));
                        andConds.push({ $or: tagOr });
                    }
                    return andConds.length ? { $and: andConds } : {};
                })() },
                { $sort: { favoritedAt: -1 } }
            ];

            const totalCountResult = await Fav.aggregate([ ...favouritesAggregation, { $count: 'total' } ]);
            const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;

            const favourites = await Fav.aggregate([
                ...favouritesAggregation,
                { $skip: skip },
                { $limit: parseInt(limit) },
                { $project: { _id: 1, userId: 1, linkId: 1, favoritedAt: 1, createdAt: 1, updatedAt: 1, link: '$linkDetails' } }
            ]);

            const totalPages = Math.ceil(totalCount / parseInt(limit));

            res.status(200).json({
                success: true,
                data: {
                    favourites,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages,
                        totalCount,
                        hasNextPage: parseInt(page) < totalPages,
                        hasPrevPage: parseInt(page) > 1
                    }
                },
                message: `Found ${totalCount} favourites${q ? ` for "${q}"` : ''}${type ? ` in '${type}'` : ''}${tagParts.length ? ` with tags '${tagParts.join(',')}'` : ''}`
            });

        } catch (error) {
            console.error('Search favourites error:', error);
            res.status(500).json({ success: false, message: 'Failed to search favourites', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
        }
    }

    /**
     * Combined search - search both links and favourites
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

            // Search favourites if requested
            if (type === 'all' || type === 'favourites') {
                const favsReq = { ...req, query: { ...req.query, limit: type === 'favourites' ? limit : Math.ceil(limit / 2) } };
                const favsRes = {
                    status: () => ({ json: (data) => { results.favourites = data; } })
                };
                await SearchController.searchFavourites(favsReq, favsRes);
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
                const tagLower = tagQuery.toLowerCase();
                let ids = [];
                try {
                    ids = await LinkTag.find({ userId, tagName: tagLower }).distinct('linkId');
                } catch (e) {}

                const baseCond = { userId: userId, isActive: true };
                const finalCond = ids.length ? { $and: [ baseCond, { _id: { $in: ids } } ] } : { $and: [ baseCond, { $or: [
                    { tagsNormalized: { $in: [tagLower] } },
                    { tags: { $elemMatch: { $regex: toRegex(tagQuery) } } },
                    { tags: { $regex: toRegex(tagQuery) } }
                ] } ] };

                const [links, totalCount] = await Promise.all([
                    Link.find(finalCond)
                        .sort({ createdAt: -1 })
                        .skip(skip)
                        .limit(parseInt(limit))
                        .lean(),
                    Link.countDocuments(finalCond)
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

            } else if (type === 'favourites') {
                // Search in user's favourites by tag
                const favourites = await Fav.aggregate([
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
                            $or: [
                                { 'linkDetails.tagsNormalized': { $in: [tagLower] } },
                                { 'linkDetails.tags': { $elemMatch: { $regex: toRegex(tagQuery) } } },
                                { 'linkDetails.tags': { $regex: toRegex(tagQuery) } }
                            ]
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
                            $or: [
                                { 'linkDetails.tagsNormalized': { $in: [tagLower] } },
                                { 'linkDetails.tags': { $elemMatch: { $regex: toRegex(tagQuery) } } },
                                { 'linkDetails.tags': { $regex: toRegex(tagQuery) } }
                            ]
                        }
                    },
                    { $count: 'total' }
                ]);

                const totalCount = totalCountResult.length > 0 ? totalCountResult[0].total : 0;
                const totalPages = Math.ceil(totalCount / parseInt(limit));

                res.status(200).json({
                    success: true,
                    data: {
                        favourites,
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
