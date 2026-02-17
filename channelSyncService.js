// backend/src/services/channelSyncService.js
const Playlist = require('../models/Playlist');
const Channel = require('../models/Channel');
const MagStalkerService = require('./magStalkerService');
const XtreamService = require('./xtreamService');
const M3UService = require('./m3uService');

class ChannelSyncService {
    constructor(playlistId) {
        this.playlistId = playlistId;
    }

    async syncPlaylist() {
        try {
            const playlist = await Playlist.findById(this.playlistId);
            if (!playlist) {
                throw new Error('Playlist not found');
            }

            console.log(`🔄 Syncing playlist: ${playlist.name} (Type: ${playlist.type})`);

            let service;
            let channels = [];
            let syncResult = {};

            switch (playlist.type) {
                case 'mag':
                case 'stalker':
                    service = new MagStalkerService(playlist.sourceUrl, playlist.macAddress);
                    const magData = await service.syncAll();
                    channels = magData.channels || [];
                    syncResult = {
                        accountInfo: magData.accountInfo,
                        profile: magData.profile,
                        genres: magData.genres
                    };
                    break;

                case 'xtream':
                    service = new XtreamService(
                        playlist.sourceUrl, 
                        playlist.xtreamUsername, 
                        playlist.xtreamPassword
                    );
                    const xtreamData = await service.syncAll();
                    channels = xtreamData.channels || [];
                    syncResult = {
                        serverInfo: xtreamData.serverInfo,
                        categories: xtreamData.categories
                    };
                    break;

                case 'm3u':
                    service = new M3UService(playlist.sourceUrl);
                    channels = await service.parsePlaylist();
                    break;

                default:
                    // Try to detect type from URL
                    if (playlist.sourceUrl.includes('get.php') || 
                        playlist.sourceUrl.includes('player_api.php')) {
                        // Likely Xtream Codes
                        console.log('Detected Xtream Codes playlist');
                        const xtreamService = new XtreamService(
                            playlist.sourceUrl,
                            playlist.xtreamUsername,
                            playlist.xtreamPassword
                        );
                        const xtreamData = await xtreamService.syncAll();
                        channels = xtreamData.channels || [];
                        playlist.type = 'xtream';
                    } else if (playlist.macAddress) {
                        // Has MAC address, likely MAG
                        console.log('Detected MAG Stalker playlist');
                        const magService = new MagStalkerService(playlist.sourceUrl, playlist.macAddress);
                        const magData = await magService.syncAll();
                        channels = magData.channels || [];
                        playlist.type = 'mag';
                    } else {
                        throw new Error('Unsupported playlist type');
                    }
            }

            // Update channels in database
            await this.updateChannels(channels, playlist);

            // Update playlist with sync results
            playlist.lastSync = new Date();
            playlist.channelCount = channels.length;
            playlist.status = 'active';
            playlist.syncData = syncResult;
            await playlist.save();

            return {
                success: true,
                channelCount: channels.length,
                playlist: playlist
            };
        } catch (error) {
            console.error('Sync failed:', error.message);
            
            // Update playlist with error
            await Playlist.findByIdAndUpdate(this.playlistId, {
                status: 'error',
                lastSync: new Date(),
                error: error.message
            });
            
            throw error;
        }
    }

    // Add this as a new strategy
async getStreamWithExactVLCHeaders(channel) {
    const url = await this.getChannelStream(channel);
    const cleanUrl = this.extractUrlFromCmd(url) || url;
    
    return {
        uri: cleanUrl,
        headers: {
            'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
            'Accept': 'video/mp2t, video/quicktime, video/*, */*',
            'Accept-Language': 'en_US',
            'Connection': 'keep-alive',
            'Range': 'bytes=0-',  // VLC sends this
        }
    };
}

    async updateChannels(channels, playlist) {
        try {
            const existingChannels = await Channel.find({ playlistId: playlist._id });
            
            // Create a set of new channel IDs for quick lookup
            const newChannelIds = new Set(channels.map(c => c.channelId.toString()));
            
            // Delete channels that are no longer in the playlist
            for (const existingChannel of existingChannels) {
                if (!newChannelIds.has(existingChannel.channelId.toString())) {
                    await Channel.findByIdAndDelete(existingChannel._id);
                    console.log(`Deleted channel: ${existingChannel.name}`);
                }
            }
            
            // Update or Create Channels
            for (const channelData of channels) {
                const channelId = channelData.channelId.toString();
                
                // Check if we have existing channel settings in the playlist
                const existingSettings = playlist.channelSettings?.find(
                    s => s.channelId === channelId
                );
                
                try {
                    await Channel.findOneAndUpdate(
                        { playlistId: playlist._id, channelId: channelId },
                        {
                            ...channelData,
                            playlistId: playlist._id,
                            isVisible: existingSettings ? existingSettings.isVisible : true,
                            customName: existingSettings?.customName,
                            customLogo: existingSettings?.customLogo,
                            customOrder: existingSettings?.customOrder,
                            updatedAt: new Date()
                        },
                        { upsert: true, new: true }
                    );
                } catch (channelError) {
                    console.error(`Failed to update channel ${channelData.name}:`, channelError.message);
                }
            }
            
            console.log(`✅ Channel sync completed: ${channels.length} channels for ${playlist.name}`);
        } catch (error) {
            console.error('Update channels failed:', error);
            throw error;
        }
    }

    async getChannelsForCustomer(customerId) {
        try {
            // Get all playlists assigned to this customer
            const playlists = await Playlist.find({
                assignedCustomers: customerId,
                isActive: true
            });
            
            let allChannels = [];

            for (const playlist of playlists) {
                const channels = await Channel.find({
                    playlistId: playlist._id,
                    isVisible: true
                }).lean();

                // Apply custom settings from playlist
                const channelsWithSettings = channels.map(channel => {
                    const settings = playlist.channelSettings?.find(
                        s => s.channelId === channel.channelId.toString()
                    );
                    return {
                        ...channel,
                        name: settings?.customName || channel.name,
                        logo: settings?.customLogo || channel.logo,
                        order: settings?.customOrder || channel.customOrder || 999,
                        playlistName: playlist.name,
                        playlistType: playlist.type
                    };
                });
                
                allChannels = [...allChannels, ...channelsWithSettings];
            }

            // Sort by custom order
            allChannels.sort((a, b) => (a.order || 999) - (b.order || 999));

            return allChannels;
        } catch (error) {
            console.error('Get channels for customer failed:', error);
            throw error;
        }
    }
}

module.exports = ChannelSyncService;