module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    const tracker = body.tracker && typeof body.tracker === 'object' ? body.tracker : {};
    const history = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    const image = body.image && typeof body.image === 'object' ? body.image : null;
    if (!message && !(image && typeof image.dataUrl === 'string')) return res.status(400).json({ error: 'A message or image is required.' });

    const systemPrompt = [
      'You are an intense but supportive weight-cut and meal-choices coach inside a personal weight tracker app.',
      'Write in a tactical, highly personalized style similar to a settlement note or trading desk update.',
      'Ground every answer in the tracker data, recent entries, and any meal image details. If uncertain, say so clearly.',
      'Give practical advice about meal timing, water retention, step count, appetite control, and next-meal planning.',
      'Do not prescribe medications, do not give blood-pressure management instructions, and do not diagnose.',
      'Do not present exact next-day weight moves as guaranteed facts. Use cautious ranges and confidence language.',
      'If the uploaded food photo is ambiguous, say what you can and cannot tell from the image.',
      'Detailed answers are welcome; the user likes specific, structured coaching.'
    ].join(' ');

    const trackerText = [
      `Baseline: ${tracker.baseline ?? 'unknown'} kg`,
      `Goal: ${tracker.goal ?? 'unknown'} kg`,
      `Latest weigh-in: ${tracker.latestWeight ?? 'unknown'} kg on ${tracker.latestDate ?? 'unknown'}`,
      `Total lost: ${tracker.totalLost ?? 'unknown'} kg`,
      `To goal: ${tracker.toGoal ?? 'unknown'} kg`,
      `BMI: ${tracker.bmi ?? 'unknown'}`,
      `Days tracked: ${tracker.daysTracked ?? 'unknown'}`,
      `Recent 7-entry move: ${tracker.last7Change ?? 'unknown'} kg`,
      `Sub-80 reached: ${tracker.sub80Reached ? 'yes' : 'no'}`,
      `Recent entries: ${JSON.stringify(tracker.recentEntries || [])}`
    ].join('\n');

    const historyText = history
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      .map(item => `${item.role.toUpperCase()}: ${item.content.trim()}`)
      .join('\n\n');

    const prompt = [
      systemPrompt,
      '',
      'TRACKER SNAPSHOT',
      trackerText,
      '',
      `WEEKLY SUMMARY: ${summary || 'None saved yet.'}`,
      '',
      'RECENT CHAT HISTORY',
      historyText || 'No prior messages this week.',
      '',
      'LATEST USER REQUEST',
      message || 'Please analyze the attached meal photo and give tactical advice.'
    ].join('\n');

    const parts = [{ text: prompt }];
    if (image && typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:')) {
      const split = image.dataUrl.split(',');
      const header = split[0] || '';
      const data = split[1] || '';
      const mimeMatch = header.match(/^data:(.*?);base64$/);
      if (mimeMatch && data) {
        parts.push({ inline_data: { mime_type: mimeMatch[1] || image.mimeType || 'image/jpeg', data } });
      }
    }

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 1400 } })
    });
    const out = await r.json();
    if (!r.ok) return res.status(500).json({ error: out && out.error && out.error.message ? out.error.message : 'Gemini request failed.' });
    const text = (((out || {}).candidates || [])[0] || {}).content;
    const reply = text && Array.isArray(text.parts) ? text.parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n').trim() : '';
    if (!reply) return res.status(500).json({ error: 'No coach reply returned.' });

    const summarySuggestion = [
      tracker.latestWeight ? `Latest weight ${tracker.latestWeight} kg on ${tracker.latestDate}.` : '',
      message ? `Current focus: ${message.slice(0, 180)}` : '',
      reply.slice(0, 220)
    ].filter(Boolean).join(' ');

    res.status(200).json({ reply, summarySuggestion });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
};
