async function buildParlay() {
    const sog = document.getElementById('sogCount').value;
    const points = document.getElementById('pointsCount').value;

    const response = await fetch(`/build-parlay?sog=${sog}&points=${points}`);
    const bets = await response.json();

    const resultsDiv = document.getElementById('parlayResults');
    resultsDiv.innerHTML = "<h3>Suggested Parlay:</h3>";

    bets.forEach(bet => {
        resultsDiv.innerHTML += `
            <p>
                <strong>${bet.player}</strong> - ${bet.market} Over ${bet.line} <br>
                Avg: ${bet.avgStat} | Odds: ${bet.odds}
            </p>
        `;
    });
}