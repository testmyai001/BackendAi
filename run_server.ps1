# PowerShell script to run the FastAPI server with virtual environment

# Navigate to script directory
Set-Location $PSScriptRoot

# Activate virtual environment
Write-Host "🔧 Activating virtual environment..." -ForegroundColor Cyan
.\venv\Scripts\Activate.ps1

# Check if venv is activated
if ($env:VIRTUAL_ENV) {
    Write-Host "✅ Virtual environment activated: $env:VIRTUAL_ENV" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to activate virtual environment" -ForegroundColor Red
    exit 1
}

# Initialize database if needed
Write-Host "📦 Checking database..." -ForegroundColor Cyan
python init_db.py

# Start the server
Write-Host "🚀 Starting FastAPI server..." -ForegroundColor Green
Write-Host "📍 Server running at: http://127.0.0.1:8000" -ForegroundColor Yellow
Write-Host "📚 API Docs at: http://127.0.0.1:8000/docs" -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow

uvicorn main:app --host 127.0.0.1 --port 8000
