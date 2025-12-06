$filePath = 'C:\Users\Suraj\Desktop\BackendAi\ReactAi\App.tsx'
$content = Get-Content $filePath -Raw

# Fix 1: Update lock state initialization
$oldLock = '  // Lock State
  const [isLocked, setIsLocked] = useState(false);'

$newLock = '  // Lock State - Persisted to localStorage
  const [isLocked, setIsLocked] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("appLocked");
      return saved === "true";
    }
    return false;
  });

  // Persist lock state to localStorage
  useEffect(() => {
    localStorage.setItem("appLocked", isLocked.toString());
  }, [isLocked]);'

$content = $content -replace [regex]::Escape($oldLock), $newLock

# Fix 2: Add scroll lock effect after dark mode effect
$darkModeEffect = '  }, [darkMode]);

  // Toast Timer'

$scrollLockEffect = '  }, [darkMode]);

  // Disable scrolling when app is locked
  useEffect(() => {
    if (isLocked) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
  }, [isLocked]);

  // Toast Timer'

$content = $content -replace [regex]::Escape($darkModeEffect), $scrollLockEffect

Set-Content $filePath $content -Encoding UTF8
Write-Host "Lock persistence fixed successfully!"
