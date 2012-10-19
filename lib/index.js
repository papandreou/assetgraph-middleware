var AssetGraph = require('assetgraph'),
    transforms = AssetGraph.transforms,
    URL = require('url'),
    query = AssetGraph.query;

require('bufferjs');
require('express-hijackresponse');

module.exports = function (options) {
    if (!options || !options.root) {
        throw new Error('options.root is mandatory');
    }
    var processedAssetByUrl = {};

    return function (req, res, next) {
        var url = req.url,
            asset = processedAssetByUrl[url];
        if (asset && !asset.isInitial) {
            // Processed non-initial asset, assume that the URL is unique and serve straight from memory:
            res.setHeader('Content-Type', asset.contentType + (asset.isText ? '; charset=' + asset.encoding : ''));
            if (asset.cacheControl) {
                res.setHeader('Cache-Control', cacheControl);
            }
            // TODO: Use https://github.com/visionmedia/send or similar:
            if (asset.etag) {
                res.setHeader('ETag', asset.etag);
                var ifNoneMatch = req.headers['if-none-match'];
                if (ifNoneMatch && ifNoneMatch.indexOf(asset.etag) !== -1) {
                    return res.send(304);
                }
            }
            if (req.method === 'HEAD') {
                return res.send(200);
            }
            res.end(asset.rawSrc);
        } else {
            var syntheticIfNoneMatch = false;
            if (req.accepts('html') || /\*\/\*/.test(req.headers.accept)) {
                delete req.headers['if-modified-since'];

                if (asset && asset.maxAge && ((new Date().getTime() - asset.date.getTime()) / 1000 < asset.maxAge)) {
                    if (asset.isText) {
                        res.charset = asset.encoding;
                    }
                    res.contentType(asset.contentType);
                    res.setHeader('Content-Type', asset.contentType);
                    if (asset.expires) {
                        res.setHeader('Expires', asset.expires.toUTCString());
                    }
                    if (asset.cacheControl) {
                        // Subtract the current age of the asset from the max-age of the Cache-Control header:
                        res.setHeader('Cache-Control', asset.cacheControl.replace(/max-age=(\d+)/, function () {
                            return "max-age=" + (asset.maxAge - Math.floor((new Date().getTime() - asset.date.getTime()) / 1000));
                        }));
                    }
                    if (options.debug) {
                        res.setHeader('X-AssetGraph-Middleware-Cache', 'hit');
                    }
                    if (asset.etag) {
                        res.setHeader('ETag', asset.etag);
                    }
                    if (asset.etag && req.headers['if-none-match'] && req.headers['if-none-match'].indexOf(asset.etag) !== -1) {
                        res.send(304);
                    } else {
                        res.statusCode = 200;
                        res.end(asset.rawSrc);
                    }
                    return;
                } else if (asset && asset.etag && !req.headers['if-none-match']) {
                    // We have a cached version of this asset and would like to avoid optimizing it again, but we need
                    // to check with upstream that our cached version is current. Rewrite to a conditional request:
                    req.headers['if-none-match'] = asset.etag;
                    syntheticIfNoneMatch = true;
                }

                res.hijack(function (err, res) {
                    var etag = res.getHeader('ETag'),
                        contentType = res.getHeader('Content-Type');

                    if (asset && etag && (!asset.etag || asset.etag !== etag) && processedAssetByUrl[url] === asset) {
                        // Our cached version is no longer current, purge it:
                        delete processedAssetByUrl[url];
                    }

                    if (res.statusCode === 304) {
                        if (syntheticIfNoneMatch) {
                            // Our cached version of the optimized asset is still current. Deliver it to the client:
                            res.setHeader('Content-Type', asset.contentType + (asset.isText ? '; charset=' + asset.encoding : ''));
                            if (options.debug) {
                                res.setHeader('X-AssetGraph-Middleware-Cache', 'revalidated-hit');
                            }
                            res.statusCode = 200;
                            return res.end(asset.rawSrc);
                        } else {
                            // Client's cached version is current, send a 304:
                            if (options.debug) {
                                res.setHeader('X-AssetGraph-Middleware-Cache', 'pass-through-hit');
                            }
                            return res.end();
                        }
                    } else {
                        var matchContentType = contentType && contentType.match(/^text\/html(?:;\s*charset=([a-z0-9\-]+))?$/i);
                        if (matchContentType) {
                            // Not cached or outdated, optimize it, save it, then deliver to the client:
                            res.removeHeader('Content-Length');
                            if (options.debug) {
                                res.setHeader('X-AssetGraph-Middleware-Cache', 'miss');
                            }
                            var encoding = matchContentType[1] || 'iso-8859-1',
                                chunks = [];
                            res.on('data', function (chunk) {
                                chunks.push(chunk);
                            }).on('end', function () {
                                var now = new Date(),
                                    cacheControl = res.getHeader('Cache-Control'),
                                    expires = res.getHeader('Expires'),
                                    maxAge = 0,
                                    matchCacheControl = cacheControl && cacheControl.match(/\bmax-age=(\d+)/);
                                if (matchCacheControl) {
                                    maxAge = parseInt(matchCacheControl[1], 10);
                                } else if (expires) {
                                    expires = new Date(expires);
                                    if (!isNaN(expires.getTime())) {
                                        maxAge = Math.floor((expires.getTime() - now.getTime()) / 1000);
                                    }
                                }
                                var date = new Date(res.getHeader('date'));
                                if (isNaN(date.getTime())) {
                                    date = now;
                                }

                                var assetGraph = new AssetGraph({root: options.root}),
                                    htmlAsset = new AssetGraph.assets.Html({
                                        rawSrc: Buffer.concat(chunks),
                                        url: URL.resolve(assetGraph.root, req.url),
                                        encoding: encoding,
                                        isInitial: true,
                                        etag: etag,
                                        date: date,
                                        expires: expires,
                                        cacheControl: res.getHeader('Cache-Control'),
                                        maxAge: maxAge
                                    });

                                assetGraph
                                    .loadAssets(htmlAsset)
                                    .queue(options.transform)
                                    .queue(function (assetGraph) {
                                        assetGraph.findAssets({isInline: false}).forEach(function (asset) {
                                            processedAssetByUrl['/' + asset.url.replace(assetGraph.root, '')] = asset;
                                        });
                                        processedAssetByUrl[req.url] = htmlAsset;
                                    })
                                    .run(function (err) {
                                        if (err) {
                                            return next(err);
                                        }
                                        res.end(htmlAsset.rawSrc);
                                    });
                            });
                        } else {
                            res.unhijack();
                        }
                    }
                });
            }
            next();
        }
    };
};
