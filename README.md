assetgraph-middleware
=====================

Middleware that allows you to use AssetGraph to manipulate HTML pages
and their related assets while they are being served.


Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install assetgraph-middleware


Example
-------

An Express-based static file server that bundles JavaScript and CSS,
inlines JavaScript, and assigns md5-derived urls to CSS, shortcut
icons and background images:

    var express = require('express'),
        root = '/path/to/static/files';

    express.createServer()
        .use(express.logger())
        .use(require('assetgraph-middleware')({
            root: root,
            transform: function (assetGraph, cb) {
                assetGraph
                    .populate({
                        followRelations: {
                            type: ['HtmlStyle', 'HtmlScript', 'CssImage', 'HtmlShortcutIcon'],
                            to: {
                                url: /^file:/
                            }
                        }
                    })
                    .bundleRelations({type: ['HtmlStyle', 'HtmlScript']})
                    .inlineRelations({type: 'HtmlScript'})
                    .prettyPrintAssets({type: ['Html', 'JavaScript', 'Css']})
                    .moveAssetsInOrder({type: assetGraph.constructor.query.not('Html')}, function (asset) {
                        return '/static/' + asset.md5Hex + asset.extension;
                    })
                    .run(cb);
            }
        }))
        .use(express['static'](root))
        .use(express.errorHandler())
        .listen(3000);


License
-------

3-clause BSD license -- see the `LICENSE` file for details.
