Add-Type -AssemblyName System.Drawing

function New-Icon {
    param([int]$size, [string]$outPath)
    
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'HighQuality'
    $g.InterpolationMode = 'HighQualityBicubic'
    
    # Background gradient
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        [System.Drawing.Color]::FromArgb(99, 102, 241),
        [System.Drawing.Color]::FromArgb(139, 92, 246)
    )
    
    # Rounded rect background
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [int]($size * 0.22)
    if ($r -lt 2) { $r = 2 }
    $gp.AddArc(0, 0, $r, $r, 180, 90)
    $gp.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
    $gp.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90)
    $gp.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
    $gp.CloseFigure()
    $g.FillPath($brush, $gp)
    
    # Envelope
    $penW = [Math]::Max(1, [int]($size * 0.027))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penW)
    $ex = [int]($size * 0.19)
    $ey = [int]($size * 0.31)
    $ew = [int]($size * 0.625)
    $eh = [int]($size * 0.406)
    $g.DrawRectangle($pen, $ex, $ey, $ew, $eh)
    
    # Envelope flap
    $p1 = New-Object System.Drawing.Point($ex, $ey)
    $p2 = New-Object System.Drawing.Point([int]($size * 0.5), [int]($size * 0.53))
    $p3 = New-Object System.Drawing.Point(($ex + $ew), $ey)
    $g.DrawLine($pen, $p1, $p2)
    $g.DrawLine($pen, $p2, $p3)
    
    # Globe circle
    $gx = [int]($size * 0.625)
    $gy = [int]($size * 0.156)
    $gr = [int]($size * 0.28)
    $gbrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 27, 75))
    $g.FillEllipse($gbrush, $gx, $gy, $gr, $gr)
    $g.DrawEllipse($pen, $gx, $gy, $gr, $gr)
    
    # Text on envelope
    if ($size -ge 48) {
        $fs = [Math]::Max(6, [int]($size * 0.11))
        $font = New-Object System.Drawing.Font('Arial', $fs, [System.Drawing.FontStyle]::Bold)
        $tbrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
        $g.DrawString('A', $font, $tbrush, [float]($size * 0.30), [float]($size * 0.47))
        $font.Dispose()
        $tbrush.Dispose()
    }
    
    $g.Dispose()
    $pen.Dispose()
    $brush.Dispose()
    $gbrush.Dispose()
    $gp.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created $outPath ($size x $size)"
}

$baseDir = "c:\Users\samar\OneDrive\Desktop\lingo_mail\icons"
New-Icon -size 16 -outPath "$baseDir\icon16.png"
New-Icon -size 48 -outPath "$baseDir\icon48.png"
New-Icon -size 128 -outPath "$baseDir\icon128.png"
Write-Host "All icons created!"
