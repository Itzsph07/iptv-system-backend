const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working', 
    time: new Date().toISOString(),
    note: 'Your backend is running!'
  });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// ========== PROXY STREAM ROUTE (NO AUTH REQUIRED) ==========
const axios = require('axios');

// Proxy stream with MAG headers - NO AUTH MIDDLEWARE
app.get('/api/proxy/stream', async (req, res) => {
    try {
        const { url, mac } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const decodedUrl = decodeURIComponent(url);
        console.log('🔌 Proxying stream:', decodedUrl);

        const macAddress = mac || '00:1A:79:00:00:00';

        const headers = {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
            'X-User-Agent': 'Model: MAG250; Link: WiFi',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Cookie': `mac=${macAddress}; stb_lang=en; timezone=GMT`,
        };

        try {
            const urlObj = new URL(decodedUrl);
            headers['Referer'] = `${urlObj.protocol}//${urlObj.host}/c/`;
        } catch (e) {
            headers['Referer'] = 'http://10431-plan.ott-cdn.me:80/c/';
        }

        const response = await axios({
            method: 'GET',
            url: decodedUrl,
            headers,
            responseType: 'stream',
            timeout: 30000
        });

        res.set({
            'Content-Type': response.headers['content-type'] || 'video/mp2t',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
        });

        response.data.pipe(res);

    } catch (error) {
        console.error('❌ Proxy error:', error.message);
        res.status(500).json({ error: 'Streaming failed' });
    }
});

// Test endpoint
app.get('/api/proxy/test', (req, res) => {
    res.json({ message: 'Proxy route is working' });
});

// Routes that require authentication
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/channels', require('./routes/channels'));

// ========== TOKEN REFRESH SYSTEM ==========
const tokenRefreshService = require('./services/tokenRefreshService');

// Admin token management routes
app.use('/api/admin/token', require('./routes/tokenRoutes'));

// Run token check every 6 hours
setInterval(async () => {
  console.log('⏰ Running scheduled token refresh...');
  try {
    await tokenRefreshService.refreshAllPlaylists();
  } catch (error) {
    console.error('Scheduled token refresh failed:', error);
  }
}, 6 * 60 * 60 * 1000); // 6 hours

// Run once on startup (after 10 seconds)
setTimeout(() => {
  tokenRefreshService.refreshAllPlaylists().catch(console.error);
}, 10000);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// DEBUG ROUTE - Remove later
app.get('/api/debug/data', async (req, res) => {
    try {
        const Playlist = require('./models/Playlist');
        const Customer = require('./models/Customer');
        const User = require('./models/User');
        
        const playlists = await Playlist.find().populate('owner', 'username');
        const customers = await Customer.find().populate('playlists');
        const users = await User.find().select('-password');
        
        res.json({
            success: true,
            counts: {
                playlists: playlists.length,
                customers: customers.length,
                users: users.length
            },
            data: {
                playlists: playlists.map(p => ({ id: p._id, name: p.name, owner: p.owner?.username })),
                customers: customers.map(c => ({ id: c._id, name: c.name, playlists: c.playlists?.length })),
                users: users.map(u => ({ id: u._id, username: u.username, role: u.role }))
            }
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

module.exports = app;