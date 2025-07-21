const core = require('@actions/core');
const { OTPAuth } = require('otpauth');
const fetch = require('node-fetch');

class OneMinAutoCheckin {
    constructor() {
        // Prioritize GitHub Action inputs, then environment variables
        this.email = core.getInput('email') || process.env.EMAIL;
        this.password = core.getInput('password') || process.env.PASSWORD;
        this.totpSecret = core.getInput('totp_secret') || process.env.TOTP_SECRET;
        this.deviceId = this.generateDeviceId();
        
        if (!this.email || !this.password) {
            const error = 'Missing required parameters: email and password';
            core.setFailed(error);
            throw new Error(error);
        }
        
        console.log(`📧 Account: ${this.email.substring(0, 3)}***${this.email.substring(this.email.indexOf('@'))}`);
        console.log(`🔐 TOTP: ${this.totpSecret ? 'Configured' : 'Not configured'}`);
    }

    generateDeviceId() {
        const chars = '0123456789abcdef';
        const randomString = (length) =>
            Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

        const part1 = randomString(16);
        const part2 = randomString(15);
        return `$device:${part1}-${part2}-17525636-16a7f0-${part1}`;
    }

    async login() {
        console.log('🚀 Starting login request...');
        
        const loginUrl = 'https://api.1min.ai/auth/login';
        const headers = {
            'Host': 'api.1min.ai',
            'Content-Type': 'application/json',
            'X-Auth-Token': 'Bearer',
            'Mp-Identity': this.deviceId,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://app.1min.ai',
            'Referer': 'https://app.1min.ai/'
        };

        const body = JSON.stringify({
            email: this.email,
            password: this.password
        });

        try {
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers,
                body
            });

            const data = await response.json();
            console.log(`📊 Login response status: ${response.status}`);

            if (response.status === 200 && data.user) {
                if (data.user.mfaRequired) {
                    console.log('🔐 TOTP verification required');
                    if (this.totpSecret) {
                        return await this.performMFAVerification(data.user.token);
                    } else {
                        throw new Error('TOTP required but secret key not provided');
                    }
                } else {
                    console.log('✅ Login successful (no TOTP required)');
                    await this.displayCreditInfo(data);
                    return data;
                }
            } else {
                let errorMsg = 'Login failed';
                if (data.message) {
                    errorMsg = data.message;
                } else if (response.status === 401) {
                    errorMsg = 'Invalid email or password';
                } else if (response.status === 429) {
                    errorMsg = 'Too many requests, please try again later';
                }
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            throw error;
        }
    }

    async performMFAVerification(tempToken) {
        console.log('🔐 Starting TOTP verification process...');

        const totp = new OTPAuth.TOTP({
            secret: this.totpSecret,
            digits: 6,
            period: 30,
            algorithm: 'SHA1'
        });

        const totpCode = totp.generate();
        console.log('🎯 Generated TOTP verification code');

        const mfaUrl = 'https://api.1min.ai/auth/mfa/verify';
        const headers = {
            'Host': 'api.1min.ai',
            'Content-Type': 'application/json',
            'X-Auth-Token': 'Bearer',
            'Mp-Identity': this.deviceId,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://app.1min.ai',
            'Referer': 'https://app.1min.ai/'
        };

        const body = JSON.stringify({
            code: totpCode,
            token: tempToken
        });

        try {
            const response = await fetch(mfaUrl, {
                method: 'POST',
                headers,
                body
            });

            const data = await response.json();
            console.log(`📊 TOTP verification response status: ${response.status}`);

            if (response.status === 200) {
                console.log('✅ TOTP verification successful!');
                await this.displayCreditInfo(data);
                return data;
            } else {
                const errorMsg = data.message || `HTTP ${response.status}`;
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('❌ TOTP verification failed:', error.message);
            throw error;
        }
    }

    async displayCreditInfo(responseData) {
        try {
            const user = responseData.user;
            if (user && user.teams && user.teams.length > 0) {
                const teamInfo = user.teams[0];
                const teamId = teamInfo.teamId || teamInfo.team.uuid;
                const authToken = responseData.token || responseData.user.token;

                const userName = (user.teams && user.teams[0] && user.teams[0].userName) ?
                    user.teams[0].userName :
                    (user.email ? user.email.split('@')[0] : 'User');

                if (teamId && authToken) {
                    const usedCredit = teamInfo.usedCredit || 0;
                    await this.fetchLatestCredit(teamId, authToken, userName, usedCredit);
                } else {
                    const remainingCredit = teamInfo.team.credit || 0;
                    const usedCredit = teamInfo.usedCredit || 0;
                    const totalCredit = remainingCredit + usedCredit;
                    const availablePercent = totalCredit > 0 ? ((remainingCredit / totalCredit) * 100).toFixed(1) : 0;

                    console.log('💰 Credit Information:');
                    console.log(`   Available: ${remainingCredit.toLocaleString()}`);
                    console.log(`   Used: ${usedCredit.toLocaleString()}`);
                    console.log(`   Available percentage: ${availablePercent}%`);
                    console.log(`✅ ${userName} login successful | Balance: ${remainingCredit.toLocaleString()} (${availablePercent}%)`);
                }
            } else {
                console.log('⚠️ Unable to retrieve credit information');
                console.log('✅ Login successful!');
            }
        } catch (error) {
            console.error('❌ Error displaying credit information:', error.message);
            console.log('✅ Login successful!');
        }
    }

    async fetchLatestCredit(teamId, authToken, userName, usedCredit) {
        console.log(`🔄 Fetching latest credit information (Team ID: ${teamId})`);

        const creditUrl = `https://api.1min.ai/teams/${teamId}/credits`;
        const headers = {
            'Host': 'api.1min.ai',
            'Content-Type': 'application/json',
            'X-Auth-Token': `Bearer ${authToken}`,
            'Mp-Identity': this.deviceId,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://app.1min.ai',
            'Referer': 'https://app.1min.ai/'
        };

        try {
            const response = await fetch(creditUrl, { headers });
            console.log(`📊 Credit API response status: ${response.status}`);

            if (response.status === 200) {
                const creditData = await response.json();
                const latestCredit = creditData.credit || 0;
                const totalCredit = latestCredit + usedCredit;
                const availablePercent = totalCredit > 0 ? ((latestCredit / totalCredit) * 100).toFixed(1) : 0;

                console.log('💰 Latest Credit Information:');
                console.log(`   Available: ${latestCredit.toLocaleString()}`);
                console.log(`   Used: ${usedCredit.toLocaleString()}`);
                console.log(`   Available percentage: ${availablePercent}%`);
                console.log(`✅ ${userName} login successful | Balance: ${latestCredit.toLocaleString()} (${availablePercent}%)`);
            } else {
                console.log(`❌ Failed to fetch credit - Status: ${response.status}`);
                console.log(`✅ ${userName} login successful`);
            }
        } catch (error) {
            console.error('❌ Failed to fetch credit information:', error.message);
            console.log(`✅ ${userName} login successful`);
        }
    }

    async run() {
        try {
            console.log('🎬 1min.ai auto checkin started');
            console.log(`⏰ Execution time: ${new Date().toLocaleString()}`);
            
            await this.login();
            
            console.log('🎉 Checkin process completed');
            core.setOutput('success', 'true');
            core.setOutput('message', 'Checkin successful');
            return true;
        } catch (error) {
            console.error('💥 Checkin process failed:', error.message);
            core.setFailed(error.message);
            core.setOutput('success', 'false');
            core.setOutput('message', error.message);
            process.exit(1);
        }
    }
}

// Execute checkin
if (require.main === module) {
    const checkin = new OneMinAutoCheckin();
    checkin.run();
}

module.exports = OneMinAutoCheckin;