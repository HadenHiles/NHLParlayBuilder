const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

const playerIdCache = {};  // { "Auston Matthews": 8479318 }
const playerStatsCache = {};
const CURRENT_SEASON = '20242025';

async function getPlayerId(playerName) {
    if (playerIdCache[playerName]) {
        return playerIdCache[playerName];
    }

    // Example teams list (you can expand or automate based on today's games)
    const teams = ['TOR', 'EDM', 'OTT', 'MTL'];

    for (let team of teams) {
        const res = await fetch(`https://api-web.nhle.com/v1/roster/${team}/current`);
        const roster = await res.json();

        console.log(team);
        for (let player of roster.forwards.concat(roster.defensemen, roster.goalies)) {
            const fullName = `${player.firstName.default} ${player.lastName.default}`;
            if (fullName.toLowerCase() === playerName.toLowerCase()) {
                playerIdCache[playerName] = player.id;
                return player.id;
            }
        }
    }

    console.warn(`Player ID not found for: ${playerName}`);
    return null;
}

async function getPlayerStats(playerName) {
    if (playerStatsCache[playerName]) {
        return playerStatsCache[playerName];
    }

    const playerId = await getPlayerId(playerName);
    if (!playerId) {
        return { avgSOG: 0, avgPoints: 0 };
    }

    const statsUrl = `https://api-web.nhle.com/v1/players/${playerId}/stats?season=${CURRENT_SEASON}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();

    if (!statsData || !statsData.splits || statsData.splits.length === 0) {
        console.warn(`No stats for: ${playerName}`);
        return { avgSOG: 0, avgPoints: 0 };
    }

    const stats = statsData.splits[0].stat;
    const gamesPlayed = stats.gamesPlayed || 1;
    const totalShots = stats.shots || 0;
    const totalPoints = (stats.goals || 0) + (stats.assists || 0);

    const avgSOG = (totalShots / gamesPlayed).toFixed(1);
    const avgPoints = (totalPoints / gamesPlayed).toFixed(1);

    const playerStats = { avgSOG, avgPoints };
    playerStatsCache[playerName] = playerStats;

    return playerStats;
}


async function scrapeOddsTraderProps() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://www.oddstrader.com/nhl/event/ottawa-senators-vs-toronto-maple-leafs/player-props/', { waitUntil: 'networkidle2' });

    // Step 1: Get all game links for today's player props
    const gameLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
        return links.filter(link => link.includes('/nhl/event/') && link.includes('/player-props/'));
    });

    let allProps = [];

    // Step 2: Loop through each game's player props page
    for (let gameURL of gameLinks) {
        const gamePage = await browser.newPage();
        await gamePage.goto(gameURL, { waitUntil: 'networkidle2' });

        const props = await gamePage.evaluate(() => {
            let data = [];
            const rows = document.querySelectorAll('.player-props-table tbody tr');

            rows.forEach(row => {
                const player = row.querySelector('.player-name')?.innerText.trim();
                const market = row.querySelector('.prop-type')?.innerText.trim();
                const line = row.querySelector('.prop-line')?.innerText.trim();
                const odds = row.querySelector('.best-odds')?.innerText.trim();

                if (player && market && line && odds) {
                    if (market.includes('Shots on Goal') || market.includes('Points')) {
                        data.push({ player, market, line, odds });
                    }
                }
            });

            return data;
        });

        allProps = allProps.concat(props);
        await gamePage.close();
    }

    await browser.close();
    return allProps;
}

app.get('/build-parlay', async (req, res) => {
    let sogCount = parseInt(req.query.sog);
    let pointsCount = parseInt(req.query.points);

    console.log(sogCount);
    console.log(pointsCount);
    const props = await scrapeOddsTraderProps();
    let filteredBets = [];

    for (let bet of props) {
        const stats = await getPlayerStats(bet.player);

        const meetsCriteria = (
            (bet.market.includes('Shots') && stats.avgSOG > parseFloat(bet.line) && sogCount > 0) ||
            (bet.market.includes('Points') && stats.avgPoints > parseFloat(bet.line) && pointsCount > 0)
        );

        if (meetsCriteria) {
            filteredBets.push({
                player: bet.player,
                market: bet.market,
                line: bet.line,
                odds: bet.odds,
                avgStat: bet.market.includes('Shots') ? stats.avgSOG : stats.avgPoints
            });

            if (bet.market.includes('Shots')) sogCount--;
            if (bet.market.includes('Points')) pointsCount--;
        }

        if (sogCount <= 0 && pointsCount <= 0) break;
    }

    res.json(filteredBets);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
