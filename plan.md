1. **Fix the visualisation:**
   - Modify `js/circuit.js` to handle gaps `> 0.5 * P` cleanly without snapping incorrectly. Replace `P * 0.5` threshold with `P * 0.9` or similar for both queued and unqueued cars, as queues can easily exceed half the track length. (Wait, I've already applied a temporary patch, I will formalize it.)

2. **Add Borel-Tanner Extension:**
   - Add a slider in `js/model.js` for the number of simultaneous brakers $k$ (default 1).
   - Update `sampleCascadeTree` and `sampleBusyPeriod` in `js/queue.js` to seed with $k$ nodes instead of 1.
   - Update `js/chart.js` to draw the Borel-Tanner curve when $k > 1$.

3. **Add Goodness of Fit:**
   - Add a metric for goodness of fit (like Chi-squared test) in `js/queue.js` or `js/chart.js`.
   - Display this metric on the UI (perhaps in the gantry or near the chart).

4. **Complete Pre Commit Steps:**
   - Make sure proper testing, verifications, reviews and reflections are done.

5. **Submit the changes.**
