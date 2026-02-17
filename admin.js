const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const playlistController = require('../controllers/playlistController');
const customerController = require('../controllers/customerController');

// Dashboard
router.get('/dashboard', [auth, admin], async (req, res) => {
    try {
        const Customer = require('../models/Customer');
        const Playlist = require('../models/Playlist');
        const User = require('../models/User');
        const Channel = require('../models/Channel');
        
        const customers = await Customer.countDocuments();
        const playlists = await Playlist.countDocuments();
        const users = await User.countDocuments({ role: 'customer' });
        const channels = await Channel.countDocuments();
        
        res.json({
            success: true,
            stats: { customers, playlists, users, channels }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========== PLAYLIST ROUTES ==========
// Get all playlists
router.get('/playlists', [auth, admin], playlistController.getPlaylists);

// Create playlist
router.post('/playlists', [auth, admin], playlistController.createPlaylist);

// Update playlist
router.put('/playlists/:id', [auth, admin], playlistController.updatePlaylist);

// DELETE playlist - THIS WAS MISSING
router.delete('/playlists/:id', [auth, admin], playlistController.deletePlaylist);

// Test connection
router.post('/playlists/test-connection', [auth, admin], playlistController.testConnection);

// Sync playlist
router.post('/playlists/:playlistId/sync', [auth, admin], playlistController.syncPlaylist);

// Get playlist channels
router.get('/playlists/:playlistId/channels', [auth, admin], playlistController.getChannels);

// Update channel visibility
router.put('/playlists/:playlistId/channels/:channelId', [auth, admin], playlistController.updateChannelVisibility);

// Bulk update channels
router.post('/playlists/:playlistId/channels/bulk', [auth, admin], playlistController.bulkUpdateChannels);

// ========== CUSTOMER ROUTES ==========
// Get all customers
router.get('/customers', [auth, admin], customerController.getCustomers);

// Create customer
router.post('/customers', [auth, admin], customerController.createCustomer);

// Update customer
router.put('/customers/:id', [auth, admin], customerController.updateCustomer);

// DELETE customer - THIS WAS MISSING
router.delete('/customers/:id', [auth, admin], customerController.deleteCustomer);

// Assign playlist to customer
router.post('/customers/:customerId/playlists/:playlistId', [auth, admin], customerController.assignPlaylist);

// Remove playlist from customer
router.delete('/customers/:customerId/playlists/:playlistId', [auth, admin], customerController.removePlaylist);

module.exports = router;