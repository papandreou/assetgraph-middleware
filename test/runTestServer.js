module.exports = function runTestServer(app) {
    // Listen on a vacant TCP port and hand back the url + app
    app.listen(0);
    var address = app.address();
    return {
        hostname: '127.0.0.1',
        port: address.port,
        host: '127.0.0.1:' + address.port,
        url: 'http://127.0.0.1:' + address.port,
        app: app
    };
};
