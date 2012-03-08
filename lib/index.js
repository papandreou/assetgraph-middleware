var AssetGraph = require('assetgraph'),
    transforms = AssetGraph.transforms,
    query = AssetGraph.query;

require('bufferjs');
require('express-hijackresponse');

module.exports = function (options) {
    if (!options || !options.root) {
        throw new Error('options.root is mandatory');
    }
    var optimizedAssetByUrl = {};

    function optimizeHtmlAsset(htmlAsset, cb) {
        new AssetGraph({root: options.root})
            .loadAssets(htmlAsset)
            .queue(options.transform)
            .queue(function (assetGraph) {
                assetGraph.findAssets({isInline: false}).forEach(function (asset) {
                    optimizedAssetByUrl['/' + asset.url.replace(assetGraph.root, '')] = asset;
                });
            })
            .run(cb);
    }

    return function (req, res, next) {
        var url = req.url,
            asset = optimizedAssetByUrl[url];
        if (asset && !asset.isInitial) {
            // Optimized non-HTML asset, assume that the URL is unique and serve straight from memory:
            res.setHeader('Content-Type', asset.contentType + (asset.isText ? '; charset=' + asset.encoding : ''));
            res.setHeader('ETag', '"' + asset.md5Hex + '"');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            if (req.method === 'HEAD') {
                return res.send(200);
            } else if (req.headers['if-none-match'] && req.headers['if-none-match'].indexOf('"' + asset.md5Hex + '"') !== -1) {
                return res.send(304);
            }
            res.end(asset.rawSrc);
        } else {
            var syntheticIfNoneMatch = false;
            if (req.accepts('html') || /\*\/\*/.test(req.headers.accept)) {
                delete req.headers['if-modified-since'];

                if (asset && asset.etag && !req.headers['if-none-match']) {
                    // We have a cached version of this asset and would like to avoid optimizing it again, but we need
                    // to check with upstream that our cached version is current. Rewrite to a conditional request:
                    req.headers['if-none-match'] = asset.etag;
                    syntheticIfNoneMatch = true;
                }

                res.hijack(function (err, res) {
                    var etag = res.getHeader('ETag'),
                        contentType = res.getHeader('Content-Type');

                    if (asset && etag && (!asset.etag || asset.etag !== etag) && optimizedAssetByUrl[url] === asset) {
                        // Our cached version is no longer current, purge it:
                        delete optimizedAssetByUrl[url];
                    }

                    if (res.statusCode === 304) {
                        if (syntheticIfNoneMatch) {
                            // Our cached version of the optimized asset is still current. Deliver it to the client:
                            res.setHeader('Content-Type', asset.contentType + (asset.isText ? '; charset=' + asset.encoding : ''));
                            res.statusCode = 200;
                            return res.end(asset.rawSrc);
                        } else {
                            // Client's cached version is current, send a 304:
                            return res.end();
                        }
                    } else {
                        // Not cached or outdated, optimize it, save it, then deliver to the client:
                        var matchContentType = contentType && contentType.match(/^text\/html(?:;\s*charset=([a-z0-9\-]+))?$/i);
                        if (matchContentType) {
                            res.removeHeader('Content-Length');
                            var encoding = matchContentType[1] || 'iso-8859-1',
                                chunks = [];
                            res.on('data', function (chunk) {
                                chunks.push(chunk);
                            }).on('end', function () {
                                var htmlAsset = new AssetGraph.assets.Html({
                                    rawSrc: Buffer.concat(chunks),
                                    url: 'file://' + options.root + req.url,
                                    encoding: encoding,
                                    isInitial: true,
                                    etag: etag
                                });
                                optimizeHtmlAsset(htmlAsset, function (err) {
                                    if (err) {
                                        return next(err);
                                    }
                                    optimizedAssetByUrl[req.url] = htmlAsset;
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
