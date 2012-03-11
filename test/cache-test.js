var vows = require('vows'),
    express = require('express'),
    assetGraphMiddleware = require('../lib'),
    request = require('request'),
    assert = require('assert');

function runTestServer(app) {
    // Listen on a vacant TCP port and hand back the url + app
    app.listen(0);
    var address = app.address();
    return {
        hostname: address.address,
        port: address.port,
        host: address.address + ':' + address.port,
        url: 'http://' + address.address + ':' + address.port,
        app: app
    };
};

vows.describe('caching').addBatch({
    'Create a test server': {
        topic: function () {
            this.testServer = runTestServer(
                express.createServer()
                    .use(assetGraphMiddleware({
                        root: __dirname,
                        debug: true,
                        transform: function (assetGraph) {
                            assetGraph.findAssets({type: 'Html'}).forEach(function (htmlAsset) {
                                htmlAsset.parseTree.body.innerHTML = 'assetgraph-middleware was here!';
                                htmlAsset.markDirty();
                            });
                        }
                    }))
                    .use(function (req, res, next) {
                        var etag = '"myetag"';
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        res.setHeader('ETag', etag);
                        if (req.url === '/farfuture.html') {
                            res.setHeader('Cache-Control', 'public, max-age=1000000');
                        }
                        if ('if-none-match' in req.headers && req.headers['if-none-match'].indexOf(etag) !== -1) {
                            res.send(304);
                        } else {
                            res.send("<!DOCTYPE html>\n<html><head></head><body></body></html>");
                        }
                    })
            );
            return this.testServer;
        },
        'GET /': {
            topic: function (appInfo) {
                request({url: this.testServer.url}, this.callback);
            },
            'should return a manipulated asset and a cache miss': function (err, res, body) {
                assert.ok(!err);
                assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
                assert.equal(res.headers['x-assetgraph-middleware-cache'], 'miss');
                assert.equal(res.headers['etag'], '"myetag"');
                assert.matches(body, /assetgraph-middleware was here/);
            },
            'then GET / again': {
                topic: function (appInfo) {
                    request({url: this.testServer.url}, this.callback);
                },
                'should return a manipulated asset and a cache hit': function (err, res, body) {
                    assert.ok(!err);
                    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
                    assert.equal(res.headers['x-assetgraph-middleware-cache'], 'revalidated-hit');
                    assert.matches(body, /assetgraph-middleware was here/);
                },
                'then do a conditional GET /': {
                    topic: function (appInfo) {
                        request({
                            url: this.testServer.url,
                            headers: {
                                'if-none-match': '"myetag"'
                            }
                        }, this.callback);
                    },
                    'should return a 304 and a cache hit': function (err, res, body) {
                        assert.ok(!err);
                        assert.equal(res.statusCode, 304);
                        assert.equal(res.headers['x-assetgraph-middleware-cache'], 'pass-through-hit');
                    }
                }
            }
        },
        'GET /farfuture.html': {
            topic: function (appInfo) {
                request({url: this.testServer.url + '/farfuture.html'}, this.callback);
            },
            'should return a manipulated asset and a cache miss': function (err, res, body) {
                assert.ok(!err);
                assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
                assert.equal(res.headers['x-assetgraph-middleware-cache'], 'miss');
                assert.equal(res.headers['cache-control'], 'public, max-age=1000000');
                assert.equal(res.headers['etag'], '"myetag"');
                assert.matches(body, /assetgraph-middleware was here/);
            },
            'then wait 1.2 second and GET /farfuture.html again': {
                topic: function (appInfo) {
                    setTimeout(function () {
                        request({url: this.testServer.url + '/farfuture.html'}, this.callback);
                    }.bind(this), 1200);
                },
                'should return a manipulated asset and a cache hit': function (err, res, body) {
                    assert.ok(!err);
                    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
                    assert.equal(res.headers['x-assetgraph-middleware-cache'], 'hit');
                    assert.equal(res.headers['etag'], '"myetag"');
                    assert.matches(body, /assetgraph-middleware was here/);
                },
                'the max-age in the Cache-Control header should be decremented': function (err, res, body) {
                    assert.matches(res.headers['cache-control'], /^public, max-age=99999[789]$/);
                },
                'then do a conditional GET /farfuture.html': {
                    topic: function (appInfo) {
                        request({
                            url: this.testServer.url + '/farfuture.html',
                            headers: {
                                'if-none-match': '"myetag"'
                            }
                        }, this.callback);
                    },
                    'should return a manipulated asset and a cache hit': function (err, res, body) {
                        assert.ok(!err);
                        assert.equal(res.statusCode, 304);
                        assert.equal(res.headers['x-assetgraph-middleware-cache'], 'hit');
                    }
                }
            }
        }
    }
})['export'](module);
