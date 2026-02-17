// backend/src/services/xtreamService.js
const axios = require('axios');

class XtreamService {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.username = username;
        this.password = password;
        this.serverInfo = null;
    }

    /**
     * Get server info and authenticate
     */
    async getServerInfo() {
        try {
            const url = `${this.baseUrl}/player_api.php`;
            const params = {
                username: this.username,
                password: this.password,
                action: 'handshake'
            };

            console.log('Xtream handshake URL:', url);
            
            const response = await axios.get(url, {
                params,
                timeout: 10000
            });

            this.serverInfo = response.data;
            console.log('Xtream server info:', {
                status: this.serverInfo.user?.status,
                expires: this.serverInfo.user?.exp_date,
                categories: this.serverInfo.categories?.length
            });

            return this.serverInfo;
        } catch (error) {
            console.error('Xtream handshake failed:', error.message);
            throw error;
        }
    }

    /**
     * Get all live channels
     */
    async getLiveChannels() {
        try {
            const url = `${this.baseUrl}/player_api.php`;
            const params = {
                username: this.username,
                password: this.password,
                action: 'get_live_streams'
            };

            const response = await axios.get(url, {
                params,
                timeout: 30000
            });

            console.log(`Found ${response.data.length} live channels`);
            return this.transformChannels(response.data);
        } catch (error) {
            console.error('Get live channels failed:', error.message);
            return [];
        }
    }

    /**
     * Get channel stream URL
     */
    getChannelStreamUrl(channelId, container = 'ts') {
        // Xtream Codes stream URL format
        return `${this.baseUrl}/live/${this.username}/${this.password}/${channelId}.${container}`;
    }

    /**
     * Transform channels to standard format
     */
    transformChannels(channels) {
        if (!Array.isArray(channels)) return [];

        return channels.map(channel => ({
            channelId: String(channel.stream_id),
            name: channel.name,
            originalName: channel.name,
            cmd: this.getChannelStreamUrl(channel.stream_id),
            logo: channel.stream_icon || '',
            group: channel.category_name || 'Uncategorized',
            epgId: channel.epg_channel_id || '',
            isHd: channel.hd === 1,
            sourceType: 'xtream'
        }));
    }

    /**
     * Sync all data
     */
    async syncAll() {
        console.log('Starting Xtream Codes sync...');
        console.log('Base URL:', this.baseUrl);
        console.log('Username:', this.username);

        try {
            // Get server info (handshake)
            const serverInfo = await this.getServerInfo();
            
            if (!serverInfo || !serverInfo.user || serverInfo.user.status !== 'Active') {
                throw new Error('Xtream account is not active');
            }

            // Get live channels
            const channels = await this.getLiveChannels();
            
            console.log(`✅ Synced ${channels.length} Xtream channels`);

            return {
                serverInfo: serverInfo.user,
                categories: serverInfo.categories,
                channels
            };
        } catch (error) {
            console.error('Xtream sync failed:', error.message);
            throw error;
        }
    }
}

module.exports = XtreamService;