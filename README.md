# 🎥 Screenflow Pro - High-End Screen Recording

![Hero Design](./assets/hero_design.png)

**Screenflow Pro** is a professional-grade screen recording application built with **Electron**, **TypeScript**, and **ES Modules**. It features a modern "Glassmorphism" HUD design and advanced audio mixing capabilities.

---

## 🚀 Key Features

- **Professional HUD**: Sleek, transparent dark-mode interface with "frosted glass" effects.
- **Advanced Audio Mixing**: Support for both **Microphone** and **System Audio** with custom mixing logic.
- **Source Selection**: High-definition grid-based selector for screens and individual windows.
- **Real-time Feedback**: Live recording status with a pulsing REC indicator and precise timer.
- **High Performance**: Built on Chrome's rendering engine for low-latency recording.

## 🛠️ Tech Stack

- **Framework**: Electron v29+
- **Logic**: TypeScript (Strict Mode)
- **Module System**: ES Modules (ESNext)
- **Styling**: Vanilla CSS (Custom Variables & Glassmorphism)
- **Package Manager**: pnpm

---

## 📥 Installation

1. **Clone the repository**:

   ```bash
   git clone <your-repo-url>
   cd screen-recorder
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

## 💻 Development

Start the application in development mode (automatic compilation):

```bash
pnpm run dev
```

Or run build and start separately:

```bash
pnpm run build
pnpm start
```

---

## 📁 Project Structure

- `src/`: Core TypeScript logic (Main, Preload, Renderer).
- `dist/`: Compiled JavaScript output (ignored by git).
- `assets/`: Design assets and mockups.
- `index.html`: The HUD interface.

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Built with ❤️ for professional creators.**
