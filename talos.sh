#!/bin/bash

# Talos Server Management Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.talos.pid"
LOG_FILE="$SCRIPT_DIR/talos.log"

start() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Talos server is already running (PID: $(cat "$PID_FILE"))"
        return 1
    fi
    
    echo "Starting Talos server..."
    cd "$SCRIPT_DIR"
    nohup node server/index.js > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 2
    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "✅ Talos server started successfully (PID: $(cat "$PID_FILE"))"
        echo "📊 Web UI: http://localhost:3000"
        echo "📝 Logs: tail -f $LOG_FILE"
    else
        echo "❌ Failed to start Talos server"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "No PID file found. Trying to kill any running instances..."
        pkill -f "node server/index.js" && echo "✅ Stopped Talos processes" || echo "ℹ️ No Talos processes found"
        return 0
    fi
    
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping Talos server (PID: $pid)..."
        kill "$pid"
        
        # Wait for graceful shutdown
        for i in {1..10}; do
            if ! kill -0 "$pid" 2>/dev/null; then
                break
            fi
            sleep 1
        done
        
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$pid"
        fi
        
        echo "✅ Talos server stopped"
    else
        echo "Process not running (stale PID file)"
    fi
    
    rm -f "$PID_FILE"
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        local pid=$(cat "$PID_FILE")
        echo "✅ Talos server is running (PID: $pid)"
        echo "📊 Web UI: http://localhost:3000"
        echo "💾 Memory usage: $(ps -p "$pid" -o rss= | awk '{printf "%.1f MB", $1/1024}')"
        
        # Check if port 3000 is listening
        if lsof -i :3000 >/dev/null 2>&1; then
            echo "🌐 Port 3000: listening"
        else
            echo "⚠️ Port 3000: not listening"
        fi
    else
        echo "❌ Talos server is not running"
        rm -f "$PID_FILE"
    fi
}

restart() {
    echo "Restarting Talos server..."
    stop
    sleep 2
    start
}

logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
    fi
}

case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    Start the Talos server"
        echo "  stop     Stop the Talos server"
        echo "  restart  Restart the Talos server"
        echo "  status   Show server status"
        echo "  logs     Follow server logs (Ctrl+C to exit)"
        exit 1
        ;;
esac