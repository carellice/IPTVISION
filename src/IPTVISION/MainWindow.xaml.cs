using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using IPTVISION.Models;
using IPTVISION.Services;
using IPTVISION.ViewModels;

namespace IPTVISION;

public partial class MainWindow : Window
{
    private const double PanelWidth = 360;

    private readonly MainViewModel _vm;
    private readonly DispatcherTimer _hideControlsTimer = new() { Interval = TimeSpan.FromSeconds(2.8) };
    private readonly DispatcherTimer _bannerTimer = new() { Interval = TimeSpan.FromSeconds(5) };
    private readonly Storyboard _refreshSpin;

    private bool _controlsShown;
    private bool _bannerShown;
    private bool _menuOpen;
    private bool _panelVisible;
    private bool _panelBeforeFullscreen;
    private bool _fullscreen;
    private WindowState _stateBeforeFullscreen;
    private Point _lastMouse;

    public MainWindow(MainViewModel vm)
    {
        _vm = vm;
        DataContext = vm;
        InitializeComponent();

        RestorePlacement();
        SetPanel(vm.Settings.PanelVisible, save: false);
        BuildShortcuts();

        _refreshSpin = new Storyboard { RepeatBehavior = RepeatBehavior.Forever };
        var spin = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(0.9));
        Storyboard.SetTarget(spin, RefreshGlyph);
        Storyboard.SetTargetProperty(spin, new PropertyPath("RenderTransform.Angle"));
        _refreshSpin.Children.Add(spin);

        // libVLC disegna direttamente nella finestra nativa: nessuna copia dei fotogrammi.
        Video.HandleReady += hwnd => _vm.Player.Player.Hwnd = hwnd;

        _hideControlsTimer.Tick += (_, _) => HideControls();
        _bannerTimer.Tick += (_, _) => HideBanner();

        vm.PropertyChanged += OnViewModelChanged;
        vm.MediaStarted += OnMediaStarted;
        vm.TvScrollRequested += OnTvScrollRequested;
        vm.TvSearchFocusRequested += OnTvSearchFocusRequested;
        vm.VoiceSearchRequested += StartVoiceSearch;

        SourceInitialized += (_, _) => NativeMethods.ApplyWindowStyle(new WindowInteropHelper(this).Handle);
        Loaded += OnLoaded;
        StateChanged += (_, _) => UpdateWindowStateVisuals();
        PreviewKeyDown += (_, e) => { if (HandleKey(e)) e.Handled = true; };
        Closing += OnClosing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        CreateOverlay();
        if (_vm.Settings.WinMaximized) WindowState = WindowState.Maximized;
        UpdateWindowStateVisuals();

        // Controller: stessi comandi della tastiera, solo quando IPTVISION è in primo piano.
        _gamepad = new GamepadService(k => HandleKeyCore(k, ModifierKeys.None), () => IsActive);
        _gamepad.Start();

        await _vm.InitializeAsync();
        UpdateEmptyState();
        if (!_vm.IsLoggedIn) FocusLogin();
        else if (_vm.StartInTvMode) _vm.EnterTvMode();
    }

    // ======================= ViewModel → vista =======================

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(MainViewModel.IsLoggedIn):
                if (_vm.IsLoggedIn) Focus();
                else
                {
                    if (_fullscreen) ToggleFullscreen();
                    FocusLogin();
                }
                UpdateEmptyState();
                break;
            case nameof(MainViewModel.VisibleCount):
            case nameof(MainViewModel.IsBusy):
            case nameof(MainViewModel.IsLibraryLoading):
            case nameof(MainViewModel.Mode):
                UpdateEmptyState();
                break;
            case nameof(MainViewModel.PositionMs):
            case nameof(MainViewModel.DurationMs):
                UpdateSeekSlider();
                break;
            case nameof(MainViewModel.IsTvMode):
                SyncTvWindow();
                break;
            case nameof(MainViewModel.IsVariantChooserOpen):
                if (_vm.IsVariantChooserOpen) FocusVariantList();
                else if (!_vm.IsTvMode) FocusList();
                break;
            case nameof(MainViewModel.ShowTvLayer):
                if (!_vm.ShowTvLayer && _vm.IsTvMode) { Focus(); ShowBanner(); }
                break;
            case nameof(MainViewModel.IsPaused):
                if (_vm.IsPaused) { ShowControls(); ShowBanner(); }
                break;
            case nameof(MainViewModel.IsRefreshing):
                if (_vm.IsRefreshing) _refreshSpin.Begin();
                else _refreshSpin.Stop();
                break;
            case nameof(MainViewModel.IsSettingsOpen):
                if (_vm.IsSettingsOpen && !_panelVisible) SetPanel(true, save: false);
                break;
            case nameof(MainViewModel.IsDownloadsOpen):
                if (_vm.IsDownloadsOpen && !_panelVisible) SetPanel(true, save: false);
                break;
        }
    }

    private void UpdateEmptyState()
    {
        var show = _vm.IsLoggedIn && !_vm.IsBusy && !_vm.IsLibraryLoading && _vm.VisibleCount == 0;
        EmptyState.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show) return;

        var what = _vm.Mode switch { LibraryMode.Movies => "film", LibraryMode.Series => "serie", _ => "canale" };
        if (!string.IsNullOrWhiteSpace(_vm.SearchText))
        {
            EmptyGlyph.Text = "";
            EmptyText.Text = $"Nessun {what} trovato per “{_vm.SearchText.Trim()}”";
        }
        else if (_vm.SelectedCategory?.IsFavorites == true)
        {
            EmptyGlyph.Text = "";
            EmptyText.Text = "Nessun preferito.\nPassa sopra un canale e tocca la stella, oppure premi P mentre lo guardi.";
        }
        else if (_vm.Mode == LibraryMode.Live)
        {
            EmptyGlyph.Text = "";
            EmptyText.Text = _vm.Categories.Count == 0 ? "Questo account non ha canali in diretta." : "Nessun canale in questa categoria.";
        }
        else
        {
            EmptyGlyph.Text = _vm.Mode == LibraryMode.Movies ? "" : "";
            EmptyText.Text = _vm.Categories.Count == 0
                ? $"Nessun{(_vm.Mode == LibraryMode.Movies ? " film disponibile" : "a serie disponibile")} su questo account.\nUsa ↻ in basso per riprovare."
                : "Niente in questa categoria.";
        }
    }

    private void OnMediaStarted(object item)
    {
        ShowBanner();
        ListBox? list = item switch
        {
            Channel => ChannelList,
            Movie => MovieList,
            Episode => EpisodeList,
            _ => null,
        };
        if (list != null && list.ItemsSource is System.Collections.IList items && items.Contains(item))
        {
            list.SelectedItem = item;
            list.ScrollIntoView(item);
        }
    }

    // ======================= Barra di avanzamento =======================

    private bool _seekDragging;
    private bool _seekUpdating;

    private void UpdateSeekSlider()
    {
        if (_seekDragging) return;
        _seekUpdating = true;
        SeekSlider.Maximum = Math.Max(1, _vm.DurationMs);
        SeekSlider.Value = Math.Min(_vm.PositionMs, SeekSlider.Maximum);
        _seekUpdating = false;
    }

    private void Seek_DragStarted(object sender, System.Windows.Controls.Primitives.DragStartedEventArgs e)
    {
        _seekDragging = true;
        _vm.IsSeeking = true;
    }

    private void Seek_DragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e)
    {
        _seekDragging = false;
        _vm.IsSeeking = false;
        _vm.SeekTo((long)SeekSlider.Value);
    }

    private void Seek_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_seekUpdating) return;
        if (_seekDragging) _vm.PreviewSeek((long)e.NewValue);
        else _vm.SeekTo((long)e.NewValue); // clic sulla barra
        ShowControls();
    }

    // ======================= Overlay video =======================

    private const int GwlExStyle = -20;
    private const int WsExToolWindow = 0x00000080;
    private const int WsExNoActivate = 0x08000000;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    private Window? _overlay;
    private IntPtr _overlayHwnd;
    private Int32Rect _overlayBounds;

    /// <summary>
    /// Il video è una finestra nativa: WPF non può disegnarci sopra ("airspace").
    /// Banner, comandi e notifiche vivono quindi in una finestra trasparente di proprietà
    /// di quella principale, allineata al pixel sopra l'area video e mai attivabile
    /// (la tastiera resta sempre alla finestra principale).
    /// </summary>
    private void CreateOverlay()
    {
        OverlayHolder.Child = null;
        _overlay = new Window
        {
            WindowStyle = WindowStyle.None,
            AllowsTransparency = true,
            Background = Brushes.Transparent,
            ShowInTaskbar = false,
            ShowActivated = false,
            ResizeMode = ResizeMode.NoResize,
            Focusable = false,
            Owner = this,
            DataContext = _vm,
            Content = OverlayRoot,
            FontFamily = FontFamily,
            Foreground = Foreground,
            Title = "",
        };
        NameScope.SetNameScope(_overlay, NameScope.GetNameScope(this));
        _overlayHwnd = new WindowInteropHelper(_overlay).EnsureHandle();
        SetWindowLong(_overlayHwnd, GwlExStyle, GetWindowLong(_overlayHwnd, GwlExStyle) | WsExNoActivate | WsExToolWindow);

        LocationChanged += (_, _) => UpdateOverlayBounds();
        SizeChanged += (_, _) => UpdateOverlayBounds();
        VideoHost.SizeChanged += (_, _) => UpdateOverlayBounds();
        VideoHost.IsVisibleChanged += (_, _) => UpdateOverlayBounds();
        LayoutUpdated += (_, _) => UpdateOverlayBounds();
        UpdateOverlayBounds();
    }

    private void UpdateOverlayBounds()
    {
        if (_overlay == null) return;
        if (WindowState == WindowState.Minimized || !VideoHost.IsVisible || VideoHost.ActualWidth < 1)
        {
            if (_overlay.IsVisible) _overlay.Hide();
            return;
        }

        var tl = VideoHost.PointToScreen(new Point(0, 0));
        var br = VideoHost.PointToScreen(new Point(VideoHost.ActualWidth, VideoHost.ActualHeight));
        var r = new Int32Rect((int)Math.Round(tl.X), (int)Math.Round(tl.Y),
                              (int)Math.Round(br.X - tl.X), (int)Math.Round(br.Y - tl.Y));

        if (!_overlay.IsVisible)
        {
            _overlay.Show();
            _overlayBounds = Int32Rect.Empty;
        }
        if (r == _overlayBounds) return;
        _overlayBounds = r;
        // In pixel fisici: corretto con qualsiasi scala DPI e su più monitor.
        SetWindowPos(_overlayHwnd, IntPtr.Zero, r.X, r.Y, r.Width, r.Height, SwpNoZOrder | SwpNoActivate);
    }

    private void ShowControls()
    {
        OverlayRoot.Cursor = null;
        _hideControlsTimer.Stop();
        _hideControlsTimer.Start();
        if (_controlsShown) return;
        _controlsShown = true;
        ControlBar.IsHitTestVisible = true;
        Fade(ControlBar, 1, 140);
    }

    private void HideControls()
    {
        _hideControlsTimer.Stop();
        if (_menuOpen || ControlBar.IsMouseOver || _vm.IsPaused || _seekDragging)
        {
            _hideControlsTimer.Start();
            return;
        }
        if (_fullscreen) OverlayRoot.Cursor = Cursors.None;
        if (!_controlsShown) return;
        _controlsShown = false;
        ControlBar.IsHitTestVisible = false;
        Fade(ControlBar, 0, 260);
    }

    private void ShowBanner()
    {
        _bannerTimer.Stop();
        _bannerTimer.Start();
        if (_bannerShown) return;
        _bannerShown = true;
        Fade(InfoBanner, 1, 160);
    }

    private void HideBanner()
    {
        _bannerTimer.Stop();
        if (!_bannerShown) return;
        _bannerShown = false;
        Fade(InfoBanner, 0, 380);
    }

    private static void Fade(UIElement el, double to, int ms)
    {
        var anim = new DoubleAnimation(to, TimeSpan.FromMilliseconds(ms))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        el.BeginAnimation(OpacityProperty, anim);
    }

    private void Overlay_MouseMove(object sender, MouseEventArgs e)
    {
        var p = e.GetPosition(OverlayRoot);
        if (Math.Abs(p.X - _lastMouse.X) < 2 && Math.Abs(p.Y - _lastMouse.Y) < 2) return;
        _lastMouse = p;
        ShowControls();
    }

    private void Overlay_MouseLeave(object sender, MouseEventArgs e)
    {
        if (!_menuOpen) HideControls();
    }

    private void Overlay_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        // Clic sulla barra dei comandi o sulla proposta del prossimo episodio: non è un clic sul video.
        var onVideo = !IsWithin(e.OriginalSource as DependencyObject, ControlBar) && !IsWithin(e.OriginalSource as DependencyObject, NextEpisodeCard);
        // Le frecce devono arrivare al lettore, non all'elenco rimasto con il focus.
        if (onVideo && !_vm.IsTvMode) Keyboard.Focus(this);
        if (e.ClickCount == 2)
        {
            // Come su YouTube: il primo clic ha già messo in pausa, il secondo riprende e va a schermo intero.
            if (onVideo && _vm.IsVod && _vm.Player.IsActive) _vm.TogglePlayCommand.Execute(null);
            ToggleFullscreen();
            e.Handled = true;
            return;
        }
        if (onVideo && _vm.IsVod && _vm.Player.IsActive)
        {
            _vm.TogglePlayCommand.Execute(null);
            e.Handled = true;
        }
        ShowControls();
    }

    private static bool IsWithin(DependencyObject? dep, DependencyObject ancestor)
    {
        while (dep != null)
        {
            if (dep == ancestor) return true;
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
        return false;
    }

    private void Overlay_MouseWheel(object sender, MouseWheelEventArgs e)
    {
        _vm.ChangeVolume(e.Delta > 0 ? 5 : -5);
        ShowControls();
        _vm.ShowToast(_vm.IsMuted ? "Muto" : $"Volume {_vm.Volume}");
    }

    private void Overlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (HandleKey(e)) e.Handled = true;
    }

    private void TracksButton_Click(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu { PlacementTarget = TracksButton, Placement = PlacementMode.Top, VerticalOffset = -6 };

        menu.Items.Add(new MenuItem { Header = "AUDIO", IsEnabled = false, FontSize = 11, FontWeight = FontWeights.Bold });
        var tracks = _vm.Player.GetAudioTracks();
        var current = _vm.Player.CurrentAudioTrack;
        if (tracks.Count == 0)
            menu.Items.Add(new MenuItem { Header = "Nessuna traccia disponibile", IsEnabled = false });
        foreach (var (id, name) in tracks)
        {
            var mi = new MenuItem { Header = name, IsChecked = id == current };
            mi.Click += (_, _) => _vm.Player.CurrentAudioTrack = id;
            menu.Items.Add(mi);
        }

        var subs = _vm.Player.GetSubtitleTracks();
        if (subs.Count > 0)
        {
            menu.Items.Add(new Separator());
            menu.Items.Add(new MenuItem { Header = "SOTTOTITOLI", IsEnabled = false, FontSize = 11, FontWeight = FontWeights.Bold });
            var currentSub = _vm.Player.CurrentSubtitle;
            var off = new MenuItem { Header = "Disattivati", IsChecked = currentSub < 0 };
            off.Click += (_, _) => _vm.Player.CurrentSubtitle = -1;
            menu.Items.Add(off);
            foreach (var (id, name) in subs)
            {
                var mi = new MenuItem { Header = name, IsChecked = id == currentSub };
                mi.Click += (_, _) => _vm.Player.CurrentSubtitle = id;
                menu.Items.Add(mi);
            }
        }

        menu.Items.Add(new Separator());
        menu.Items.Add(new MenuItem { Header = "FORMATO IMMAGINE", IsEnabled = false, FontSize = 11, FontWeight = FontWeights.Bold });
        var aspect = _vm.Player.AspectRatio;
        var fillRatio = $"{(int)Math.Round(VideoHost.ActualWidth)}:{(int)Math.Round(VideoHost.ActualHeight)}";
        foreach (var (value, label) in new (string? Value, string Label)[] { (null, "Automatico"), ("16:9", "16:9"), ("4:3", "4:3"), (fillRatio, "Riempi finestra") })
        {
            var isChecked = value == null ? string.IsNullOrEmpty(aspect) : aspect == value;
            var mi = new MenuItem { Header = label, IsChecked = isChecked };
            mi.Click += (_, _) => _vm.Player.AspectRatio = value;
            menu.Items.Add(mi);
        }

        menu.Closed += (_, _) => { _menuOpen = false; ShowControls(); };
        _menuOpen = true;
        menu.IsOpen = true;
    }

    // ======================= Tastiera =======================

    private bool HandleKey(KeyEventArgs e) => HandleKeyCore(e.Key == Key.System ? e.SystemKey : e.Key, Keyboard.Modifiers);

    /// <summary>Tastiera, telecomando per PC e controller passano tutti da qui.</summary>
    private bool HandleKeyCore(Key key, ModifierKeys mods)
    {
        if (!_vm.IsLoggedIn) return false;
        var ctrl = mods.HasFlag(ModifierKeys.Control);

        if (_vm.IsVariantChooserOpen) return HandleVariantKey(key);

        if (ctrl && key == Key.T) { ToggleTvMode(); return true; }
        if (ctrl && key == Key.M) { StartVoiceSearch(); return true; }
        if (HandleTvKey(key)) return true;

        // LB/RB del controller e tasti multimediali del telecomando.
        key = key switch
        {
            Key.F14 or Key.MediaPreviousTrack => Key.PageDown,
            Key.F15 or Key.MediaNextTrack => Key.PageUp,
            Key.BrowserBack => Key.Escape,
            Key.MediaPlayPause => Key.Space,
            _ => key,
        };

        if (ctrl && key == Key.F)
        {
            if (_fullscreen) ToggleFullscreen();
            if (_vm.OpenSeries != null) _vm.CloseSeriesCommand.Execute(null);
            SetPanel(true, save: true);
            _vm.IsSettingsOpen = false;
            SearchBox.Focus();
            SearchBox.SelectAll();
            return true;
        }
        if (ctrl && key == Key.R)
        {
            _vm.RefreshCommand.Execute(null);
            return true;
        }
        if (ctrl && key is Key.D1 or Key.D2 or Key.D3 or Key.NumPad1 or Key.NumPad2 or Key.NumPad3)
        {
            _vm.Mode = key is Key.D1 or Key.NumPad1 ? LibraryMode.Live : key is Key.D2 or Key.NumPad2 ? LibraryMode.Movies : LibraryMode.Series;
            if (!_panelVisible) SetPanel(true, save: !_fullscreen);
            return true;
        }

        if (SearchBox.IsKeyboardFocusWithin)
        {
            switch (key)
            {
                case Key.Escape:
                    if (_vm.SearchText.Length > 0) _vm.SearchText = "";
                    else Focus();
                    return true;
                case Key.Down:
                    FocusList();
                    return true;
                case Key.Enter:
                    // Il binding della ricerca ha un piccolo ritardo: applica subito il testo digitato.
                    SearchBox.GetBindingExpression(TextBox.TextProperty)?.UpdateSource();
                    if (ActiveList().Items.Cast<object>().FirstOrDefault(i => i is not SearchHeader) is { } first) Activate(first);
                    return true;
                default:
                    return false;
            }
        }
        if (Keyboard.FocusedElement is TextBox or System.Windows.Controls.PasswordBox) return false;
        if (mods != ModifierKeys.None && mods != ModifierKeys.Shift) return false;

        var inList = ActiveList().IsKeyboardFocusWithin;
        var vod = _vm.IsVod;

        // Griglia del pannello: le frecce spostano la selezione tra i riquadri.
        if (GridList.IsKeyboardFocusWithin && mods == ModifierKeys.None)
        {
            switch (key)
            {
                case Key.Left: ScrollGrid(_vm.GridMove(-1, 0)); return true;
                case Key.Right: ScrollGrid(_vm.GridMove(1, 0)); return true;
                case Key.Up: ScrollGrid(_vm.GridMove(0, -1)); return true;
                case Key.Down: ScrollGrid(_vm.GridMove(0, 1)); return true;
                case Key.Enter:
                    if (_vm.GridSelectedItem is { } item) Activate(item);
                    return true;
            }
        }

        if (!vod)
        {
            if (key is >= Key.D0 and <= Key.D9 && mods == ModifierKeys.None) { _vm.AppendDigit(key - Key.D0); return true; }
            if (key is >= Key.NumPad0 and <= Key.NumPad9) { _vm.AppendDigit(key - Key.NumPad0); return true; }
        }

        switch (key)
        {
            case Key.Escape:
                if (_fullscreen) ToggleFullscreen();
                else if (_vm.IsSettingsOpen) _vm.IsSettingsOpen = false;
                else if (_vm.IsDownloadsOpen) _vm.IsDownloadsOpen = false;
                else if (_vm.NextEpisodeOffer != null) _vm.CancelNextEpisodeCommand.Execute(null);
                else if (_vm.OpenSeries != null) _vm.CloseSeriesCommand.Execute(null);
                else if (_vm.IsSearchActive) _vm.SearchText = "";
                else if (_vm.IsCategoryOpen) _vm.CloseCategoryCommand.Execute(null);
                else return false;
                return true;
            case Key.F:
            case Key.F11:
                ToggleFullscreen();
                return true;

            // TV: su/giù cambiano canale. Film/episodi: su/giù volume, sinistra/destra avanzano.
            case Key.Up when !inList && !vod:
            case Key.PageUp when !vod:
                _vm.NextChannelCommand.Execute(null);
                return true;
            case Key.Down when !inList && !vod:
            case Key.PageDown when !vod:
                _vm.PreviousChannelCommand.Execute(null);
                return true;
            case Key.PageUp when vod:
            case Key.N when vod:
                _vm.NextEpisodeCommand.Execute(null);
                return true;
            case Key.PageDown when vod:
                _vm.PreviousEpisodeCommand.Execute(null);
                return true;
            case Key.Right when vod:
                _vm.SeekBy(mods == ModifierKeys.Shift ? 60_000 : 10_000);
                ShowControls();
                return true;
            case Key.Left when vod:
                _vm.SeekBy(mods == ModifierKeys.Shift ? -60_000 : -10_000);
                ShowControls();
                return true;
            case Key.Home when vod:
                _vm.RestartCommand.Execute(null);
                _vm.ShowToast("Dall'inizio");
                return true;
            case Key.Up when vod && !inList:
            case Key.Right:
            case Key.OemPlus:
            case Key.Add:
                _vm.ChangeVolume(5);
                _vm.ShowToast($"Volume {_vm.Volume}");
                return true;
            case Key.Down when vod && !inList:
            case Key.Left:
            case Key.OemMinus:
            case Key.Subtract:
                _vm.ChangeVolume(-5);
                _vm.ShowToast($"Volume {_vm.Volume}");
                return true;

            case Key.M:
                _vm.ToggleMuteCommand.Execute(null);
                _vm.ShowToast(_vm.IsMuted ? "Muto" : $"Volume {_vm.Volume}");
                return true;
            case Key.L:
                SetPanel(!_panelVisible, save: !_fullscreen);
                return true;
            case Key.I:
                if (_bannerShown) HideBanner(); else ShowBanner();
                return true;
            case Key.P when !vod:
                _vm.ToggleFavoriteCommand.Execute(null);
                return true;
            case Key.Back:
                _vm.LastChannelCommand.Execute(null);
                return true;
            case Key.R:
            case Key.F5:
                _vm.ReloadCommand.Execute(null);
                return true;
            case Key.Space:
                _vm.TogglePlayCommand.Execute(null);
                ShowControls();
                return true;
            case Key.Enter when _vm.NumberEntry != null:
                _vm.CommitNumber();
                return true;
            default:
                return false;
        }
    }

    /// <summary>La lista visibile ora nel pannello.</summary>
    private ListBox ActiveList() =>
        _vm.OpenSeries != null ? EpisodeList
        : _vm.IsSearchActive ? SearchList
        : !_vm.IsCategoryOpen ? CategoryList
        : _vm.IsGridView ? GridList
        : _vm.Mode switch
        {
            LibraryMode.Movies => MovieList,
            LibraryMode.Series => SeriesList,
            _ => ChannelList,
        };

    /// <summary>Canale/film/episodio: riproduce. Serie: apre il dettaglio con stagioni ed episodi.</summary>
    private void Activate(object? item)
    {
        switch (item)
        {
            case Channel ch: _vm.PlayChannel(ch); break;
            case Movie m: _vm.OpenMovie(m); break;
            case Series s: _vm.OpenSeriesItem(s); break;
            case Episode ep: _vm.PlayEpisode(ep); break;
            case DownloadItem d: _vm.PlayDownload(d); break;
            case CategoryItem c: _vm.OpenCategoryCommand.Execute(c); break;
            case SearchHit h: _vm.ActivateSearchHit(h); break;
        }
    }

    private void FocusList()
    {
        var list = ActiveList();
        if (list.Items.Count == 0) return;
        if (list == GridList)
        {
            GridList.Focus();
            if (_vm.GridSelectedItem == null) ScrollGrid(_vm.GridMove(0, 0));
            return;
        }
        if (list.SelectedIndex < 0) list.SelectedIndex = 0;
        list.UpdateLayout();
        if (list.ItemContainerGenerator.ContainerFromIndex(list.SelectedIndex) is ListBoxItem item) item.Focus();
        else list.Focus();
    }

    private void FocusLogin()
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (string.IsNullOrWhiteSpace(_vm.LoginServer)) ServerBox.Focus();
            else if (string.IsNullOrWhiteSpace(_vm.LoginUsername)) UserBox.Focus();
            else PasswordBox.Focus();
        }, DispatcherPriority.Input);
    }

    // ======================= Modalità TV =======================

    private GamepadService? _gamepad;

    private void ToggleTvMode()
    {
        if (_vm.IsTvMode) _vm.ExitTvMode();
        else _vm.EnterTvMode();
    }

    private void EnterTv_Click(object sender, RoutedEventArgs e) => _vm.EnterTvMode();

    private void Hyperlink_RequestNavigate(object sender, System.Windows.Navigation.RequestNavigateEventArgs e)
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { Log.Write("Apertura link non riuscita", ex); }
        e.Handled = true;
    }

    /// <summary>Entrando/uscendo dalla modalità TV la finestra passa a schermo intero e viceversa.</summary>
    private void SyncTvWindow()
    {
        if (_vm.IsTvMode && !_fullscreen) ToggleFullscreen();
        else if (!_vm.IsTvMode && _fullscreen) ToggleFullscreen();
        if (_vm.IsTvMode) Focus();
        // Da lontano servono testi più grandi: banner e comandi sul video crescono del 30%.
        OverlayRoot.LayoutTransform = _vm.IsTvMode ? new ScaleTransform(1.3, 1.3) : Transform.Identity;
    }

    /// <summary>Tasti in modalità TV: tra i riquadri si naviga solo con frecce, OK e Indietro.</summary>
    private bool HandleTvKey(Key key)
    {
        if (!_vm.IsTvMode) return false;

        if (_vm.ShowTvLayer)
        {
            var typing = TvSearchBox.IsKeyboardFocusWithin;
            switch (key)
            {
                case Key.Up: _vm.TvMove(0, -1); return true;
                case Key.Down: _vm.TvMove(0, 1); return true;
                case Key.Left when !typing: _vm.TvMove(-1, 0); return true;
                case Key.Right when !typing: _vm.TvMove(1, 0); return true;
                case Key.Enter:
                case Key.Space when !typing:
                    _vm.TvActivate();
                    return true;
                case Key.Escape:
                case Key.BrowserBack:
                case Key.Back when !typing:
                    _vm.TvBack();
                    return true;
                case Key.F14: _vm.TvSwitchTab(-1); return true;
                case Key.F15: _vm.TvSwitchTab(+1); return true;
                case Key.PageDown when !typing: _vm.TvPage(+1); return true;
                case Key.PageUp when !typing: _vm.TvPage(-1); return true;
                case Key.Apps:
                case Key.MediaPlayPause:
                    if (_vm.IsPlaying || _vm.IsVod) _vm.IsTvBrowsing = false;
                    return true;
                case Key.OemPlus or Key.Add:
                    _vm.ChangeVolume(5);
                    return true;
                case Key.OemMinus or Key.Subtract:
                    _vm.ChangeVolume(-5);
                    return true;
                case Key.F or Key.F11:
                    return !typing; // in modalità TV si resta a schermo intero
                default:
                    return false;
            }
        }

        // Si sta guardando: Indietro/Menu riporta ai riquadri, OK mostra le info (TV) o mette in pausa (film).
        switch (key)
        {
            case Key.Escape:
            case Key.Back:
            case Key.BrowserBack:
            case Key.Apps:
                _vm.ShowTvBrowser();
                return true;
            case Key.Enter when _vm.NumberEntry == null:
                if (_vm.IsVod) _vm.TogglePlayCommand.Execute(null);
                else ShowBanner();
                ShowControls();
                return true;
            case Key.F or Key.F11:
                return true;
            default:
                return false;
        }
    }

    private void StartVoiceSearch()
    {
        TextBox box;
        if (_vm.IsTvMode)
        {
            if (!_vm.ShowTvLayer) _vm.ShowTvBrowser();
            box = TvSearchBox;
        }
        else
        {
            if (!_panelVisible) SetPanel(true, save: true);
            _vm.IsSettingsOpen = false;
            box = SearchBox;
        }
        box.Focus();
        Keyboard.Focus(box);
        box.SelectAll();
        // La dettatura di Windows scrive nella casella che ha il focus: la avvia dopo che il focus è arrivato.
        Dispatcher.BeginInvoke(VoiceTyping.Start, DispatcherPriority.Input);
        _vm.ShowToast("Parla ora: dettatura vocale di Windows");
    }

    private void Mic_Click(object sender, RoutedEventArgs e) => StartVoiceSearch();

    private void OnTvSearchFocusRequested(bool focus)
    {
        if (focus)
        {
            Dispatcher.BeginInvoke(() =>
            {
                TvSearchBox.Focus();
                Keyboard.Focus(TvSearchBox);
                TvSearchBox.CaretIndex = TvSearchBox.Text.Length;
            }, DispatcherPriority.Input);
        }
        else if (TvSearchBox.IsKeyboardFocusWithin)
        {
            // Fuori dalla casella: frecce e lettere tornano alla navigazione, niente cursore lampeggiante.
            Keyboard.Focus(this);
        }
    }

    private void OnTvScrollRequested(int row)
    {
        if (row < 0 || row >= _vm.TvRows.Count) return;
        TvRowsList.ScrollIntoView(_vm.TvRows[row]);
    }

    private static object? ItemUnderMouse(MouseButtonEventArgs e)
    {
        var dep = e.OriginalSource as DependencyObject;
        while (dep != null)
        {
            if (dep is FrameworkElement { DataContext: { } dc } and (ContentPresenter or Border)
                && dc is not TvRow and not MainViewModel)
                return dc;
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
        return null;
    }

    private void TvRows_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (ItemUnderMouse(e) is { } item) _vm.TvActivateItem(item);
    }

    private void TvTabs_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (ItemUnderMouse(e) is not TvTab tab) return;
        if (tab.Section == TvSection.Exit) _vm.ExitTvMode();
        else
        {
            var dir = _vm.TvTabs.IndexOf(tab) - _vm.TvTabs.FindIndex(t => t.IsActive);
            if (dir != 0) _vm.TvSwitchTab(dir);
        }
    }

    // ======================= Liste =======================

    private void ChannelList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        var dep = e.OriginalSource as DependencyObject;
        while (dep != null && dep != sender)
        {
            if (dep is ButtonBase) return; // la stella gestisce il proprio click
            if (dep is ListBoxItem item)
            {
                Activate(item.DataContext);
                return;
            }
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
    }

    private void ChannelList_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && sender is ListBox { SelectedItem: { } item })
        {
            Activate(item);
            e.Handled = true;
        }
        else if (e.Key == Key.D && Keyboard.Modifiers == ModifierKeys.None && sender is ListBox { SelectedItem: { } sel })
        {
            // D: scarica il film, la serie o l'episodio selezionato.
            _vm.Download(sel is SearchHit h ? h.Item : sel);
            e.Handled = true;
        }
        else if (e.Key == Key.Delete && sender == DownloadList && DownloadList.SelectedItem is DownloadItem d)
        {
            _vm.DeleteDownloadCommand.Execute(d);
            e.Handled = true;
        }
    }

    /// <summary>Tasto destro su film, serie ed episodi (anche in griglia e nella ricerca): Scarica.</summary>
    private void Library_ContextMenuOpening(object sender, ContextMenuEventArgs e)
    {
        e.Handled = true;
        object? item = null;
        var dep = e.OriginalSource as DependencyObject;
        while (dep != null && dep != sender && item == null)
        {
            if (dep is FrameworkElement { DataContext: Movie or Series or Episode or SearchHit } fe) item = fe.DataContext;
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
        if (item is SearchHit h) item = h.Item;
        if (item is not (Movie or Series or Episode)) return;

        var key = item switch { Movie m => m.Key, Episode ep => ep.Key, _ => null };
        var existing = key != null ? _vm.DownloadService.Get(key) : null;
        var menu = new ContextMenu { PlacementTarget = (UIElement)sender };
        var mi = new MenuItem
        {
            Header = existing != null ? (existing.IsDone ? "Scaricato · mostra i download" : "Tra i download · mostra")
                : item is Series ? "Scarica tutti gli episodi" : "Scarica per guardare offline",
            InputGestureText = existing == null ? "D" : "",
        };
        mi.Click += (_, _) =>
        {
            if (existing == null) _vm.Download(item);
            else _vm.IsDownloadsOpen = true;
        };
        menu.Items.Add(mi);
        menu.IsOpen = true;
    }

    private void GridList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        var dep = e.OriginalSource as DependencyObject;
        while (dep != null && dep != sender)
        {
            if (dep is FrameworkElement { Tag: "tile", DataContext: { } item })
            {
                _vm.GridSelect(item);
                Activate(item);
                return;
            }
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
    }

    private void GridList_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (_vm.GridSelectedItem == null) ScrollGrid(_vm.GridMove(0, 0));
    }

    private void ScrollGrid(GridRow? row)
    {
        if (row != null) GridList.ScrollIntoView(row);
    }

    /// <summary>Ordinamento della sezione: menu con le opzioni disponibili.</summary>
    private void Sort_Click(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu { PlacementTarget = SortButton, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };
        menu.Items.Add(new MenuItem { Header = "ORDINA PER", IsEnabled = false, FontSize = 11, FontWeight = FontWeights.Bold });
        foreach (var option in _vm.SortOptions)
        {
            var mi = new MenuItem { Header = option.Label, IsChecked = option == _vm.SelectedSort };
            mi.Click += (_, _) => _vm.SelectedSort = option;
            menu.Items.Add(mi);
        }
        menu.IsOpen = true;
    }

    // ---------- Scelta della versione ----------

    /// <summary>La lista della scelta visibile ora: nel pannello o a schermo intero (modalità TV).</summary>
    private ListBox ActiveVariantList => _vm.ShowVariantOverlay ? VariantList : VariantPanelList;

    private bool HandleVariantKey(Key key)
    {
        var list = ActiveVariantList;
        var count = list.Items.Count;
        switch (key)
        {
            case Key.Up:
                if (count > 0) list.SelectedIndex = Math.Max(0, list.SelectedIndex - 1);
                break;
            case Key.Down:
                if (count > 0) list.SelectedIndex = Math.Min(count - 1, list.SelectedIndex + 1);
                break;
            case Key.Enter:
            case Key.Space:
                _vm.ChooseVariant(list.SelectedItem as ArtworkItem);
                return true;
            case Key.Escape:
            case Key.BrowserBack:
            case Key.Back:
                _vm.CloseVariants();
                return true;
            default:
                return true; // la scelta resta in primo piano: gli altri tasti non agiscono sotto
        }
        list.ScrollIntoView(list.SelectedItem);
        return true;
    }

    private void FocusVariantList()
    {
        if (!_vm.ShowVariantOverlay && !_panelVisible) SetPanel(true, save: false);
        Dispatcher.BeginInvoke(() =>
        {
            var list = ActiveVariantList;
            list.SelectedIndex = 0;
            list.Focus();
        }, DispatcherPriority.Input);
    }

    private void VariantList_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        var dep = e.OriginalSource as DependencyObject;
        while (dep != null && dep != sender)
        {
            if (dep is ListBoxItem { DataContext: ArtworkItem item })
            {
                _vm.ChooseVariant(item);
                return;
            }
            dep = dep is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(dep) : LogicalTreeHelper.GetParent(dep);
        }
    }

    private void VariantLayer_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource == VariantLayer) _vm.CloseVariants();
    }

    private void CategoryList_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        // La rotella scorre categorie e stagioni in orizzontale.
        if (sender is ListBox lb && lb.Template.FindName("ChipScroller", lb) is ScrollViewer sv)
        {
            sv.ScrollToHorizontalOffset(sv.HorizontalOffset - e.Delta * 0.6);
            e.Handled = true;
        }
    }

    // ======================= Accesso =======================

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        await _vm.LoginAsync(PasswordBox.Password);
        if (_vm.IsLoggedIn) PasswordBox.Clear();
    }

    // ======================= Finestra =======================

    private void SetPanel(bool visible, bool save)
    {
        _panelVisible = visible;
        PanelColumn.Width = new GridLength(visible ? PanelWidth : 0);
        Panel.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (!visible && _vm.IsSettingsOpen) _vm.IsSettingsOpen = false;
        if (!visible && _vm.IsDownloadsOpen) _vm.IsDownloadsOpen = false;
        if (save)
        {
            _vm.Settings.PanelVisible = visible;
            _vm.ScheduleSave();
        }
    }

    private void TogglePanel_Click(object sender, RoutedEventArgs e) => SetPanel(!_panelVisible, save: !_fullscreen);

    private void Fullscreen_Click(object sender, RoutedEventArgs e) => ToggleFullscreen();

    private void ToggleFullscreen()
    {
        if (!_fullscreen)
        {
            _fullscreen = true;
            _stateBeforeFullscreen = WindowState;
            _panelBeforeFullscreen = _panelVisible;
            TitleRow.Height = new GridLength(0);
            TitleBar.Visibility = Visibility.Collapsed;
            SetPanel(false, save: false);
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            FullscreenGlyph.Text = "";
        }
        else
        {
            _fullscreen = false;
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            WindowState = _stateBeforeFullscreen;
            TitleRow.Height = new GridLength(40);
            TitleBar.Visibility = Visibility.Visible;
            SetPanel(_panelBeforeFullscreen, save: false);
            FullscreenGlyph.Text = "";
            OverlayRoot.Cursor = null;
        }
        UpdateWindowStateVisuals();
        Activate();
    }

    private void UpdateWindowStateVisuals()
    {
        // Una finestra senza bordo massimizzata sborda oltre lo schermo dello spessore del bordo di ridimensionamento.
        Root.Margin = WindowState == WindowState.Maximized && !_fullscreen
            ? SystemParameters.WindowResizeBorderThickness
            : new Thickness(0);
        MaxButton.Content = WindowState == WindowState.Maximized ? "" : "";
        MaxButton.ToolTip = WindowState == WindowState.Maximized ? "Ripristina" : "Ingrandisci";
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void Maximize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void RestorePlacement()
    {
        var s = _vm.Settings;
        if (s.WinWidth is not double w || s.WinHeight is not double h || s.WinLeft is not double l || s.WinTop is not double t) return;
        var screen = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop,
                              SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        // Se il monitor salvato non c'è più, resta centrata.
        if (!screen.IntersectsWith(new Rect(l + 40, t + 10, Math.Max(1, w - 80), 30))) return;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = l;
        Top = t;
        Width = Math.Max(MinWidth, w);
        Height = Math.Max(MinHeight, h);
    }

    private void SavePlacement()
    {
        var s = _vm.Settings;
        var r = WindowState == WindowState.Normal && !_fullscreen ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (!r.IsEmpty && r.Width > 0)
        {
            s.WinLeft = r.Left;
            s.WinTop = r.Top;
            s.WinWidth = r.Width;
            s.WinHeight = r.Height;
        }
        s.WinMaximized = _fullscreen ? _stateBeforeFullscreen == WindowState.Maximized : WindowState == WindowState.Maximized;
        if (!_fullscreen) s.PanelVisible = _panelVisible;
        else s.PanelVisible = _panelBeforeFullscreen;
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        SavePlacement();
        _gamepad?.Stop();
        _overlay?.Close();
        _vm.Dispose();
        Video.Dispose();
    }

    private void BuildShortcuts()
    {
        (string Key, string Desc)[] rows =
        [
            ("Ctrl+1 / 2 / 3", "TV · Film · Serie TV"),
            ("↑ / ↓", "TV: cambia canale · Film: volume"),
            ("← / →", "TV: volume · Film: −/+ 10 s"),
            ("Shift+← / →", "Film: −/+ 1 minuto"),
            ("Spazio · clic sul video", "Pausa (film) · stop (TV)"),
            ("0 – 9", "Vai al canale per numero"),
            ("PagSu / PagGiù", "Episodio successivo / precedente"),
            ("Home", "Film: ricomincia dall'inizio"),
            ("Backspace", "Canale precedente · torna alla TV"),
            ("M", "Muto"),
            ("F · doppio clic", "Schermo intero"),
            ("L", "Mostra/nascondi elenco"),
            ("I", "Info"),
            ("P", "Canale preferito"),
            ("R", "Ricarica"),
            ("Ctrl+F", "Cerca"),
        ];
        for (var i = 0; i < rows.Length; i++)
        {
            ShortcutGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(24) });
            var k = new TextBlock
            {
                Text = rows[i].Key,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            var d = new TextBlock
            {
                Text = rows[i].Desc,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            Grid.SetRow(k, i);
            Grid.SetRow(d, i);
            Grid.SetColumn(d, 1);
            ShortcutGrid.Children.Add(k);
            ShortcutGrid.Children.Add(d);
        }
    }
}
