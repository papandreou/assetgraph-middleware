assetgraph-middleware
=====================

Middleware that allows you to use
<a href='https://github.com/One-com/assetgraph'>assetgraph</a> to
manipulate HTML pages and their related assets while they are being served.

Note: This module should be considered experimental for now. It doesn't
yet persist the manipulated assets to disc, so it will break if your
server has multiple workers.


Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install assetgraph-middleware


Features
--------

* Use any of the existing assetgraph transforms to express the manipulations
  you want performed (very high level syntax).
* Very composable. The original HTML files can originate from any other other
  middleware, eg. a static file server, a templating engine, or even an http proxy.
* Acts as a cache for the generated assets so the optimizations don't need to
  be performed on every request.
* Makes good use of the downstream middleware's support for conditional GET
  via ETags.


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
                // This transform will be run on an assetgraph object that contains only the Html asset.
                assetGraph
                    // Populate the assetgraph with the related assets by following <script>,
                    // <link rel="stylesheet">, url(...), and <link ref="shortcut icon">:
                    .populate({
                        followRelations: {
                            type: ['HtmlStyle', 'HtmlScript', 'CssImage', 'HtmlShortcutIcon'],
                            to: {
                                url: /^file:/
                            }
                        }
                    })
                    // Bundle Css and JavaScripts:
                    .bundleRelations({type: ['HtmlStyle', 'HtmlScript']})
                    // Turn <script src=...> into inline scripts:
                    .inlineRelations({type: 'HtmlScript'})
                    // Pretty-print Html, JavaScript, and Css assets:
                    .prettyPrintAssets({type: ['Html', 'JavaScript', 'Css']})
                    // Rename assets to <md5 of contents>.<original extension>
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
