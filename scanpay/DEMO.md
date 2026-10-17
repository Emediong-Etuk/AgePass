# ScanPay: 60-second demo script

**Setup (before recording)**
- Wallet A is your main PayBox wallet. It's the payer, so it needs at least 1 USDC and about 0.01 SOL on Solana.
- Wallet B is your second wallet and plays "Mama's Kitchen". Have its Solana address ready.
- ScanPay is enabled under **Unofficial plugins**, and your agent is connected to PayBox.
- Have a Solscan tab open on Wallet B: `https://solscan.io/account/<WALLET_B>#transfers`.
- Recording: screen on the left, phone on the right (or cut between them).

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:07 | Title card: **ScanPay: "pay this QR" for AI agents** | "Paying a crypto QR code means squinting at a long address and hoping you picked the right token and network. One wrong character and the money's gone." |
| 0:07–0:20 | Agent chat, signed in as Wallet B. Type: *"Make me a ScanPay payment request for 1 USDC on Solana to `<WALLET_B>`, labelled Mama's Kitchen, memo order-1042."* The link and QR appear. | "I'm Mama's Kitchen. I ask my agent for a 1 USDC request and get a Solana Pay link and a QR code. There's no payment processor and no sign-up." |
| 0:20–0:25 | Open the QR on your phone and hold it up. | "That's what my customer sees on the counter." |
| 0:25–0:38 | Switch to the customer's agent (Wallet A). Paste a photo of the QR, or the link, and type *"Pay this."* Show the reply: *"Pay 1 USDC to Mama's Kitchen (7xKX…) on Solana, memo: order-1042…"*, then *"Proposed: pay 1 USDC…"* | "As the customer, I just say 'pay this'. ScanPay reads the QR back to me in plain English: who, how much, which token, which network, and the memo. Then it builds the exact transaction." |
| 0:38–0:47 | The PayBox transaction window opens. Approve with your passkey (Face ID or Touch ID). | "PayBox shows the preview. I approve with my passkey, and PayBox signs and sends. The plugin never sees a key and never guesses an amount." |
| 0:47–0:56 | Refresh Solscan on Wallet B. The +1 USDC transfer appears, then open the transaction to show the memo `order-1042`. | "And there it is on Solscan: 1 USDC to Mama's Kitchen, with the order number on-chain." |
| 0:56–1:00 | End card: **ScanPay · Solana Pay + EIP-681 · SOL/USDC on Solana, ETH/USDC on Base · built on PayBox** | "ScanPay. Scan it, say it, pay it." |

**Prompts to copy**
- Merchant: `Use ScanPay to make a payment request for 1 USDC on Solana to <WALLET_B>, label "Mama's Kitchen", memo "order-1042". Show me the QR.`
- Customer: `Pay this with ScanPay: <paste link>`. If the agent asks, confirm with Wallet A.

**If something goes wrong on camera**
- If the agent asks for the amount, the link has no amount. Say "1".
- If the simulation fails, Wallet A needs USDC or a little SOL for fees and for opening the recipient's USDC account (about 0.002 SOL).
- If the proposal expired, it lasts 4 minutes. Say "pay this again" to get a fresh one.
