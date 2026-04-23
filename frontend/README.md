# Industrial IoT Monitoring & Control Frontend

A modern, industrial-grade React frontend for monitoring and controlling production line systems.

## Features

- **Real-time Monitoring**: WebSocket-based live sensor data visualization
- **Historical Analysis**: Time-series data charts with export capabilities
- **Production Control**: Admin-only control panel for production line management
- **Decision Monitoring**: Real-time decision snapshots and analysis
- **AI Interpretations**: ChatGPT-powered cycle analysis and recommendations
- **System Status**: Comprehensive health monitoring dashboard
- **Dark/Light Theme**: Industrial-grade UI with theme switching
- **Role-Based Access**: Admin and operator role support

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Zustand** - State management
- **Tailwind CSS** - Utility-first CSS framework
- **Recharts** - Chart library
- **Lucide React** - Icon library
- **Framer Motion** - Animation library

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables

Create a `.env` file in the frontend directory (or use environment variables):

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/live
```

- `VITE_API_URL`: Backend API base URL
- `VITE_WS_URL`: WebSocket URL for real-time data

## Project Structure

```
frontend/
├── src/
│   ├── components/        # Reusable components
│   │   ├── ui/           # Base UI components (Button, Card, etc.)
│   │   ├── Layout.jsx    # Main layout with sidebar
│   │   ├── Toast.jsx     # Notification system
│   │   └── SystemStatusBar.jsx
│   ├── pages/            # Page components
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── History.jsx
│   │   ├── Controls.jsx
│   │   ├── AdminPanel.jsx
│   │   ├── Decisions.jsx
│   │   ├── Interpretations.jsx
│   │   └── Status.jsx
│   ├── store/            # Zustand stores
│   │   ├── authStore.js
│   │   ├── sensorStore.js
│   │   ├── themeStore.js
│   │   ├── notificationStore.js
│   │   └── systemStatusStore.js
│   ├── api/              # API client configurations
│   ├── lib/              # Utility functions
│   ├── App.jsx           # Main app component
│   └── main.jsx          # Entry point
├── index.html
├── package.json
├── tailwind.config.js
└── vite.config.js
```

## Routes

- `/login` - Authentication (login/register)
- `/dashboard` - Real-time sensor monitoring
- `/history` - Historical sensor data analysis
- `/decisions` - Decision monitoring (mock data ready)
- `/interpretations` - ChatGPT interpretations (mock data ready)
- `/status` - System health monitoring
- `/controls` - Production control panel (admin only)
- `/admin-panel` - Admin diagnostics (admin only)

## Key Features

### Authentication

- JWT-based authentication
- Role-based access control (admin/operator)
- Protected routes

### Real-time Data

- WebSocket connection for live sensor data
- Automatic reconnection on disconnect
- Connection status indicator

### Theme System

- Dark theme (default, industrial-grade)
- Light theme option
- Persistent theme preference

### Notification System

- Toast notifications for user actions
- Notification history
- Severity-based styling (normal, warning, critical, emergency)

### Data Export

- CSV export for historical data
- JSON export for historical data
- Client-side data processing

## Development

### Adding New Pages

1. Create component in `src/pages/`
2. Add route in `src/App.jsx`
3. Add navigation link in `src/components/Layout.jsx` if needed

### Adding New UI Components

1. Create component in `src/components/ui/`
2. Use Tailwind CSS for styling
3. Follow existing component patterns

### State Management

- Use Zustand stores in `src/store/`
- Keep stores focused and modular
- Use notifications for user feedback

## Building for Production

```bash
npm run build
```

The production build will be in the `dist/` directory.

## Docker

The frontend is containerized and can be run with Docker Compose. See the main project README for Docker setup instructions.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## License

See main project LICENSE file.

