# Gelafehaus — Restaurant Owner & Operations Manual

Welcome to **Gelafehaus**! This operational guide is designed for the restaurant owner, floor managers, and kitchen staff. It details how daily ordering runs, how to control your live menu, what to do if Wi-Fi or power ever drops, and who to contact for technical support.

---

## 1. Quick Overview

Gelafehaus is an ultra-fast, contactless table-ordering system built specifically for our burger restaurant:

- **Customer Ordering URL**: `https://order.gelafehaus.com/menu?table=NN` (opened automatically by scanning tabletop QR codes).
- **Kitchen Admin Dashboard**: `https://order.gelafehaus.com/admin` (opened on the kitchen tablet or manager laptop).
- **Counter Payment**: Customers order from their phones, but **all payments occur in person at the counter**. No credit card details or payment gateways are needed on the site.

---

## 2. Daily Kitchen Operations

### 2.1 Morning Opening Routine (Takes 2 Minutes)
Every morning before doors open:
1. **Power up the Kitchen Tablet**: Plug the tablet into its dedicated counter charger. Keep it plugged in throughout the shift.
2. **Open the Admin Dashboard**: Launch Chrome or Safari and go to:
   ```
   https://order.gelafehaus.com/admin
   ```
3. **Log In**: Enter your manager credentials:
   - **Email**: `manager@gelafehaus.com`
   - **Password**: `[YOUR_RESTAURANT_PASSWORD]`
4. **Test the Audio Chime**:
   - Tap the speaker icon in the top header to unmute audio.
   - Tap **"Test Sound"** to confirm the chime is loud enough to hear over the grill and extractor fans.
5. **Keep Screen Awake**:
   - The tablet has an automatic screen wake lock enabled.
   - In your tablet settings, make sure Auto-Lock / Sleep is set to **"Never"** while charging so the screen stays live.

---

### 2.2 Order Processing Flow (Kanban Board)

The kitchen screen is organized into 4 live columns that update in real time without refreshing:

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ 1. Received 🔔  │──▶│ 2. Preparing 🍳 │──▶│ 3. Ready 🍔     │──▶│ 4. Completed ✅ │
└─────────────────┘   └─────────────────┘   └─────────────────┘   └─────────────────┘
  New incoming order    Cooks grilling        Plated & awaiting     Customer paid &
  Audio chime plays     Live customer status  pickup at counter     received food
```

1. **Received (New Order)**:
   - When a customer submits an order from their table, the tablet **rings a pleasant chime** and the new order card flashes with an amber glow.
   - The card shows the **Order Number** (e.g. `#14`), **Table Number** (e.g. `Table 07`), **Customer Name**, and all burger customizations (e.g. *Double Patty, Extra Cheddar, No Pickles*).
   - Tap **"Accept & Cook"** to acknowledge.
2. **Preparing**:
   - The card moves to the "Preparing" column.
   - The customer's mobile screen automatically updates to **"Grilling your burgers"**.
3. **Ready**:
   - When the burger is boxed/plated and ready on the pass, tap **"Mark Ready"**.
   - The customer's screen immediately notifies them: **"Order is Ready! Please collect at the counter"**.
4. **Completed**:
   - When the customer arrives at the counter, collects their food, and completes payment, tap **"Complete"**.
   - The order moves into daily history.

---

### 2.3 Rejecting an Order (e.g., Run out of ingredients)
If an order cannot be fulfilled:
1. Tap the **"Reject"** button on the order card.
2. Choose or type a brief reason (e.g., *"Brioche buns sold out"* or *"Kitchen closed"*).
3. The customer's phone instantly updates with a polite cancellation message and the specific reason so they can reorder or ask staff for assistance.

---

## 3. Menu Management & Sold-Out Toggles

You can update prices, descriptions, and item availability in seconds directly from the **Menu** tab on the tablet.

### 3.1 Marking an Item "Sold Out" (1 Click)
During a busy rush, if you run out of an ingredient (e.g. Truffle Aioli or Avocado):
1. Tap the **"Menu"** tab in the top navigation bar.
2. Locate the item (e.g., *Truffle Burger* or *Sweet Potato Fries*).
3. Click the toggle switch from **"In Stock"** to **"Sold Out"**.
4. **Result**: Within half a second, all customer phones show the item greyed out with a clear *"Sold out"* badge. Customers can no longer add it to their bag. If a customer already had it in their bag, checkout informs them before ordering.
5. Once restocked, tap the toggle back to **"In Stock"**.

---

### 3.2 Editing Prices and Item Details
1. In the **Menu** tab, click **"Edit"** on any item card.
2. Update the price (enter amount in rupees, e.g. `₹380`).
3. Modify description, ingredients, or dietary tags (*Veg, Non-Veg, Spicy*).
4. Tap **"Save Changes"**. The live menu reflects the new details immediately.

---

### 3.3 Adding Option Groups & Customizations
Each burger can have option groups:
- **Single Choice (Required)**: e.g., Bun Choice (*Brioche*, *Potato Bun*, *Gluten-Free +₹40*).
- **Multiple Choice (Optional)**: e.g., Extra Toppings (*Crispy Bacon +₹60*, *Jalapeños +₹30*).
- Set maximum selections (e.g., *Pick up to 3 sauces*).

---

## 4. Admin Account & Password Management

### 4.1 Login Security
- Kitchen tablet sessions stay logged in indefinitely.
- Do not log out at the end of the day; simply turn off the tablet display overnight or leave it on standby.

### 4.2 Resetting a Forgotten Password
If the admin password is lost or needs resetting:
1. **Option A (Instant - via Owner / Tech Admin)**:
   - Log into the Supabase Dashboard (`https://supabase.com/dashboard/project/<PROJECT_ID>`).
   - Navigate to **Authentication > Users**.
   - Click the three dots `...` next to `manager@gelafehaus.com` and select **"Send Password Reset Email"** or **"Update User"** to enter a new password.
2. **Option B (Email Reset)**:
   - On the `/admin` login screen, click *"Forgot password?"*.
   - Enter `manager@gelafehaus.com` to receive a secure password reset link.

---

## 5. Contingency Plan: What If the Site or Wi-Fi Is Down?

If your restaurant suffers a Wi-Fi outage, internet disruption, or tablet failure, **restaurant operations do not stop**. Follow this 4-step manual procedure:

```
                ┌──────────────────────────────────────────────┐
                │        EMERGENCY BACKUP FLOWCHART            │
                └──────────────────────┬───────────────────────┘
                                       │
                     Internet or System Unavailable?
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │ 1. Flip tabletop signs to "Counter Ordering" │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │ 2. Issue printed menus & paper order pads    │
                │    (White slip to grill, Yellow slip to cash)│
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │ 3. Ring up orders directly on counter POS    │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                ┌──────────────────────────────────────────────┐
                │ 4. Contact Technical Support for resolution  │
                └──────────────────────────────────────────────┘
```

### Step 5.1: Floor Staff Action
- Keep a set of 5 laminated physical paper menus under the cashier counter.
- Place small tabletop cardholders or instruct floor staff to tell seated guests:
  > *"Hi! Our digital table system is currently undergoing a quick network sync. Please review our paper menu, and our team will take your order right at the counter!"*

### Step 5.2: Paper Kitchen Tickets
- Use standard duplicate carbon paper pads:
  - **Top White Copy**: Take straight to the kitchen grill line.
  - **Bottom Yellow Copy**: Keep at the counter cash register with table number noted.

### Step 5.3: Restoring the Digital System
1. Check if the kitchen Wi-Fi router needs a power reboot (unplug power for 10 seconds, plug back in).
2. If using cellular data on the tablet, toggle Airplane Mode OFF and ON.
3. Once internet is back, reload `https://order.gelafehaus.com/admin`. The board will automatically reconnect and sync.

---

## 6. Table QR Code Stands & Replacements

The high-resolution QR stand files for Tables 01 to 15 are stored in:
- Vector SVGs (for print shops and acrylic engravers): `public/qr/table-01.svg` to `table-15.svg`
- High-Resolution PNGs (for instant printing on standard printers): `public/qr/table-01.png` to `table-15.png`

### Replacing a Damaged Stand
If a table QR sticker gets damaged, stained, or peeled:
1. Open `public/qr/table-NN.png` for that table number.
2. Print on 300 DPI sticker paper or 4×6 inch photo paper.
3. Slide into the acrylic tabletop stand.
4. Scan with your personal phone camera to confirm it opens Table NN instantly.

---

## 7. Technical Support & Contacts

Keep these contacts on hand for restaurant managers:

| Role | Contact Name | Phone / WhatsApp | Email / Details |
|---|---|---|---|
| **Lead Developer / Support** | Technical Support Team | `+91 98765 43210` | `tech@gelafehaus.com` |
| **Restaurant General Manager** | Store Manager | `+91 98765 12345` | `manager@gelafehaus.com` |
| **Cloudflare Status** | Global CDN Status | N/A | [cloudflarestatus.com](https://www.cloudflarestatus.com) |
| **Supabase Status** | Database Cloud Status | N/A | [status.supabase.com](https://status.supabase.com) |

> [!TIP]
> For questions about software updates, adding seasonal menu photography, or configuring additional tables (e.g. expanding from 15 to 25 tables), contact the Technical Support Team.
