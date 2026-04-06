const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MAX_CANDIDATES = 24;

function hasDeepSeekConfig() {
    return Boolean(process.env.DEEPSEEK_API_KEY);
}

async function chooseFacebookPostTarget(snapshot, phase) {
    if (!hasDeepSeekConfig()) {
        return null;
    }

    const prompt = buildPrompt(snapshot, phase);
    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
            model: DEFAULT_DEEPSEEK_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'You are selecting the correct Facebook group create-post target from DOM candidates. Choose create-post composers or triggers only. Never choose comment or reply boxes. Return strict JSON only.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`DeepSeek request failed (${response.status})`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('DeepSeek returned no content');
    }

    const parsed = parseJsonObject(content);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('DeepSeek returned invalid JSON');
    }

    if (parsed.pick === 'none' || !parsed.candidateId) {
        return null;
    }

    const match = snapshot.candidates.find(candidate => candidate.id === parsed.candidateId);
    if (!match) {
        throw new Error('DeepSeek selected an unknown candidate');
    }

    return {
        candidateId: match.id,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
}

function buildPrompt(snapshot, phase) {
    const phaseInstructions = phase === 'trigger'
        ? [
            'Choose the element that opens the group create-post composer at the top of the page.',
            'Prefer candidates with text or placeholder like "Write something", "Write something to the group", or "Create a public post".',
            'Never choose anything that looks like a comment box, reply box, or feed interaction.',
        ]
        : phase === 'composer'
            ? [
                'Choose only the editable field where the new group post text should be typed.',
                'Prefer a textbox with placeholder like "Create a public post" or similar create-post wording.',
                'Never choose a comment field, reply field, button, label, or non-editable container.',
            ]
            : [
                'Choose the clickable Post button that publishes the prepared post.',
                'Prefer enabled clickable controls and never choose photo buttons or toolbar actions.',
            ];

    const compact = {
        phase,
        page: snapshot.page,
        instructions: [
            'Pick the best candidate for creating a new group post.',
            'Reject comment, reply, inline feed comment, and search fields.',
            'Prefer elements near the top/main composer area.',
            ...phaseInstructions,
            'Return JSON: {"candidateId":"...","confidence":0-1,"reason":"..."} or {"pick":"none","reason":"..."}.',
        ],
        candidates: snapshot.candidates.slice(0, MAX_CANDIDATES),
    };

    return JSON.stringify(compact);
}

function parseJsonObject(text) {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            return null;
        }

        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

module.exports = {
    chooseFacebookPostTarget,
    hasDeepSeekConfig,
};