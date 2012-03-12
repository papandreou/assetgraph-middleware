var path = require('path'),
    vows = require('vows'),
    express = require('express'),
    assetGraphMiddleware = require('../lib'),
    httpProxy = require('http-proxy'),
    request = require('request'),
    assert = require('assert'),
    runTestServer = require('./runTestServer');

vows.describe('proxying').addBatch({
    'Create a test server': {
        topic: function () {
            var upstreamServer = runTestServer(
                express.createServer()
                    .use(express.static(path.resolve(__dirname, 'proxy')))
            );

            this.testServer = runTestServer(
                express.createServer()
                    .use(assetGraphMiddleware({
                        root: upstreamServer.url,
                        debug: true,
                        transform: function (assetGraph, cb) {
                            assetGraph
                                .populate()
                                .inlineRelations({type: 'HtmlStyle'})
                                .queue(function (assetGraph) {
                                    assetGraph.findAssets({type: 'Html'}).forEach(function (htmlAsset) {
                                        htmlAsset.parseTree.body.innerHTML = 'assetgraph-middleware was here!';
                                        htmlAsset.markDirty();
                                    });
                                })
                                .run(cb);
                        }
                    }))
                    .use(function () {
                        var proxy = new httpProxy.HttpProxy({
                            target: {
                                https: false,
                                host: '127.0.0.1',
                                port: upstreamServer.port
                            }
                        });
                        return function (req, res, next) {
                            proxy.proxyRequest(req, res);
                        };
                    }())
            );
            return this.testServer;
        },
        'GET /': {
            topic: function (appInfo) {
                request({url: this.testServer.url}, this.callback);
            },
            'should return a manipulated asset': function (err, res, body) {
                assert.ok(!err);
                assert.equal(res.headers['content-type'], 'text/html; charset=UTF-8');
                assert.ok(res.headers.etag);
                assert.matches(body, /assetgraph-middleware was here/);
            },
            'then GET / again': {
                topic: function (appInfo) {
                    request({url: this.testServer.url}, this.callback);
                },
                'should return a manipulated asset from cache': function (err, res, body) {
                    assert.ok(!err);
                    assert.equal(res.headers['content-type'], 'text/html; charset=UTF-8');
                    assert.equal(res.headers['x-assetgraph-middleware-cache'], 'revalidated-hit');
                    assert.matches(body, /assetgraph-middleware was here/);
                }
            }
        }
    }
})['export'](module);
