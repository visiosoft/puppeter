# Facebook Posting Assistant

Automate posting to multiple Facebook groups with AI-powered DOM selection and sequential content rotation.

## Features

- ✨ **AI-First DOM Selection** - Uses DeepSeek AI to intelligently find post triggers, composers, and submit buttons
- 🔄 **Sequential Post Rotation** - Each account cycles through posts independently
- 🖼️ **Automatic Image Attachment** - Sequential or random image selection
- 📊 **Per-Account Tracking** - Each account maintains its own position in the rotation
- 🎯 **Smart Fallback** - Configurable heuristics fallback when AI fails
- 📝 **Detailed Logging** - Track what posts were used and when

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   - Copy `.env.example` to `.env`
   - Add your DeepSeek API key from https://platform.deepseek.com
   - Configure posting mode (sequential or random)

3. **Add your content:**
   - Add Facebook group URLs to `data/groups.txt` (one per line)
   - Add post texts to `data/posts.txt` (one per line or separated by blank lines)
   - Add images to the `images/` folder (jpg, png, gif, webp)

4. **Configure your session:**
   - Save Facebook login cookies to `data/sessions/default.json`
   - Or create multiple account sessions: `data/sessions/[account-name].json`

## Post Rotation System

### How Sequential Mode Works

When `POST_SELECTION_MODE=sequential` is enabled:

1. **First Post to First Group**: Uses line 1 from `posts.txt`
2. **Second Post to Second Group**: Uses line 2 from `posts.txt`
3. **Third Post to Third Group**: Uses line 3 from `posts.txt`
4. **And so on...** cycles back to line 1 after reaching the end

### Per-Account Rotation

Each account maintains its own position:

```
Default account posts:
- Group 1: "Van Rental Company (Monthly & Weekly)"
- Group 2: "Weekly & Monthly Van Rental Services"
- Group 3: "Flexible Van Rentals – Available Weekly or Monthly"

John account posts:
- Group 1: "Van Rental Company (Monthly & Weekly)"  ← Starts from beginning
- Group 2: "Weekly & Monthly Van Rental Services"
```

### State Files

The system tracks rotation state in:
- `data/post-rotation-state.json` - Tracks which post each account is on
- `data/image-rotation-state.json` - Tracks which image each account is on

**Example state:**
```json
{
  "default": 3,
  "john": 1,
  "company2": 5
}
```

This means:
- `default` account will use post #4 next
- `john` account will use post #2 next
- `company2` account will use post #6 next

## Usage

### Basic Usage

```bash
# Post with default account (uses sequential rotation)
npm start

# Post with specific account
node run.js --account john

# Limit posts to 5 groups this session
node run.js --account john --limit 5

# Show posting statistics
npm run stats
```

### Configuration Options

Edit [.env](.env):

```env
# Post Selection Mode
POST_SELECTION_MODE=sequential  # Use different posts for each group
# or
POST_SELECTION_MODE=random      # Pick random posts each time

# AI Settings
USE_AI_FIRST=true                # Try AI first for DOM selection
USE_HEURISTICS_FALLBACK=false    # Fall back to heuristics if AI fails

# DeepSeek AI
DEEPSEEK_API_KEY=sk-your-key-here
```

## File Structure

```
data/
  ├── groups.txt                    # Facebook group URLs (one per line)
  ├── posts.txt                     # Post texts (one per line)
  ├── post-rotation-state.json      # Tracks post rotation per account
  ├── image-rotation-state.json     # Tracks image rotation per account
  ├── dashboard-config.json         # Dashboard settings
  └── sessions/
      ├── default.json              # Login cookies for default account
      └── [account].json            # Login cookies for other accounts

images/
  ├── ads1.png                      # Images to attach to posts
  ├── ads2.jpg                      # (Sequential or random selection)
  └── ...

src/
  ├── modules/
  │   ├── posting-assistant.js      # Main posting logic
  │   ├── content-variation.js      # Post + image selection
  │   └── ai-dom-selector.js        # AI DOM selection
  └── utils/
      ├── postPicker.js             # Post text selection
      ├── imagePicker.js            # Image selection
      └── groupLoader.js            # Group management
```

## Example: posts.txt

Each line becomes a separate post in the rotation:

```
Van Rental Company (Monthly & Weekly)

Weekly & Monthly Van Rental Services

Flexible Van Rentals – Available Weekly or Monthly

Van Hire Solutions for Weekly and Monthly Needs

Affordable Van Rentals – Weekly & Monthly Plans
```

## Resetting Rotation

To start from the beginning, delete or reset the state files:

```bash
# Reset post rotation for all accounts
echo "{}" > data/post-rotation-state.json

# Reset image rotation for all accounts
echo "{}" > data/image-rotation-state.json

# Or reset for specific account only
# Edit the JSON file and set the account's value to 0
```

## Troubleshooting

### Posts repeating?
- Check `POST_SELECTION_MODE=sequential` in `.env`
- Verify `data/post-rotation-state.json` is incrementing

### Want random posts instead?
- Set `POST_SELECTION_MODE=random` in `.env`

### AI not finding elements?
- Enable fallback: `USE_HEURISTICS_FALLBACK=true`
- Or fix your DeepSeek API key

### Different posts for different accounts?
- Each account automatically maintains separate rotation
- State is tracked per account label in state files

## Support

For issues or questions, check the debug files:
- `data/trigger-debug.json` - Last trigger selection attempt
- `data/composer-debug.json` - Last composer selection attempt
- `data/submit-debug.json` - Last submit button selection attempt
