// ========== IMPROVED PROXY STREAM ROUTE FOR iOS ==========
// Replace your existing /api/proxy/stream route with this:

const axios = require('axios');

// Proxy stream with MAG headers - iOS COMPATIBLE
app.get('/api/proxy/stream', async (req, res) => {
    try {
        const { url, mac } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const decodedUrl = decodeURIComponent(url);
        console.log('📌 Proxying stream:', decodedUrl);

        const macAddress = mac || '00:1A:79:00:00:00';

        // MAG headers
        const headers = {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
            'X-User-Agent': 'Model: MAG250; Link: WiFi',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'identity', // Changed from 'gzip, deflate' for iOS
            'Connection': 'keep-alive',
            'Cookie': `mac=${macAddress}; stb_lang=en; timezone=GMT`,
        };

        // Extract domain from URL for dynamic Referer
        try {
            const urlObj = new URL(decodedUrl);
            headers['Referer'] = `${urlObj.protocol}//${urlObj.host}/c/`;
        } catch (e) {
            headers['Referer'] = 'http://10431-plan.ott-cdn.me:80/c/';
        }

        // Handle range requests (critical for iOS)
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        console.log('Making request with headers:', headers);

        // Stream the response
        const response = await axios({
            method: 'GET',
            url: decodedUrl,
            headers,
            responseType: 'stream',
            timeout: 30000,
            validateStatus: (status) => status < 500 // Accept 200, 206, etc.
        });

        // Log response info
        console.log('✅ Got response:', {
            status: response.status,
            contentType: response.headers['content-type'],
            contentLength: response.headers['content-length']
        });

        // Set appropriate headers for iOS
        const responseHeaders = {
            'Content-Type': response.headers['content-type'] || 'video/mp2t',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        };

        // Handle partial content (range requests)
        if (response.status === 206) {
            res.status(206);
            responseHeaders['Content-Range'] = response.headers['content-range'];
            responseHeaders['Accept-Ranges'] = 'bytes';
        } else {
            responseHeaders['Accept-Ranges'] = 'bytes';
        }

        // Copy content-length if available
        if (response.headers['content-length']) {
            responseHeaders['Content-Length'] = response.headers['content-length'];
        }

        res.set(responseHeaders);

        // Pipe the stream to client
        response.data.pipe(res);

        // Handle errors
        response.data.on('error', (err) => {
            console.error('❌ Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Streaming failed' });
            }
        });

        // Log when stream ends
        response.data.on('end', () => {
            console.log('✅ Stream ended successfully');
        });

    } catch (error) {
        console.error('❌ Proxy error:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText
        });
        
        if (!res.headersSent) {
            if (error.response?.status === 401) {
                res.status(401).json({ error: 'Unauthorized - Invalid MAC or token' });
            } else if (error.response?.status === 404) {
                res.status(404).json({ error: 'Stream not found' });
            } else {
                res.status(500).json({ error: 'Streaming failed: ' + error.message });
            }
        }
    }
});

// Test endpoint
app.get('/api/proxy/test', (req, res) => {
    res.json({ 
        message: 'Proxy route is working',
        timestamp: new Date().toISOString()
    });
});

// OPTIONS endpoint for CORS preflight
app.options('/api/proxy/stream', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Max-Age': '86400'
    });
    res.sendStatus(204);
});