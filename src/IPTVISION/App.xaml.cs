using System.Threading;
using System.Windows;
using System.Windows.Threading;
using IPTVISION.Services;
using IPTVISION.ViewModels;

namespace IPTVISION;

public partial class App : Application
{
    private Mutex? _singleInstance;
    private Mutex? _running;

    protected override void OnStartup(StartupEventArgs e)
    {
        // Esiste finché un'istanza qualsiasi (anche con un altro profilo) è aperta:
        // il setup lo usa per aspettare la chiusura prima di sostituire i file.
        _running = new Mutex(false, "IPTVISION.Running");

        // Una sola istanza: due player sullo stesso account consumerebbero due connessioni.
        var mutexName = AppPaths.Profile == null ? "IPTVISION.SingleInstance" : "IPTVISION.SingleInstance." + AppPaths.Hash(AppPaths.Profile);
        _singleInstance = new Mutex(true, mutexName, out var isFirst);
        // Dopo il cambio di stile la vecchia istanza si sta chiudendo: si aspetta che liberi il posto.
        if (!isFirst && e.Args.Contains(RestartArg))
        {
            try { isFirst = _singleInstance.WaitOne(TimeSpan.FromSeconds(15)); }
            catch (AbandonedMutexException) { isFirst = true; }
        }
        if (!isFirst)
        {
            NativeMethods.ActivateExistingWindow("IPTVISION");
            Shutdown();
            return;
        }

        DispatcherUnhandledException += OnUnhandled;
        AppDomain.CurrentDomain.UnhandledException += (_, ev) => Log.Write("Eccezione non gestita", ev.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, ev) => { Log.Write("Task non osservato", ev.Exception); ev.SetObserved(); };

        base.OnStartup(e);

        try
        {
            var settings = SettingsService.Load();
            if (settings.Skin == "skeuo")
                Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/Themes/Skeuo.xaml") });
            if (settings.Skin == "dueffe")
                Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/Themes/Dueffe.xaml") });
            if (settings.Skin == "metro")
            {
                Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/Themes/Metro.xaml") });
                // Modern UI: angoli vivi e niente ombre anche dove MainWindow li scrive a mano. I cerchi (lati uguali, raggio pari a metà) restano.
                // SizeChanged e non Loaded: WPF manda Loaded solo ai rami che hanno un gestore proprio.
                EventManager.RegisterClassHandler(typeof(System.Windows.Controls.Border), FrameworkElement.SizeChangedEvent, new SizeChangedEventHandler((s, _) =>
                {
                    var b = (System.Windows.Controls.Border)s;
                    if (b.CornerRadius == default && b.Effect == null) return;
                    var round = b.ActualWidth > 0 && Math.Abs(b.ActualWidth - b.ActualHeight) < 1 && b.CornerRadius.TopLeft >= b.ActualWidth / 2 - 1;
                    if (!round) b.CornerRadius = new CornerRadius(0);
                    b.Effect = null;
                }));
            }
            var vm = new MainViewModel(settings);
            var window = new MainWindow(vm);
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            Log.Write("Avvio fallito", ex);
            MessageBox.Show($"IPTVISION non è riuscito ad avviarsi:\n\n{ex.Message}", "IPTVISION", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private const string RestartArg = "--restart";

    /// <summary>Riapre il programma (per esempio dopo il cambio di stile grafico): la nuova istanza aspetta la chiusura di questa.</summary>
    public static void Restart()
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!, RestartArg) { UseShellExecute = false });
        Current.MainWindow?.Close();
    }

    private static void OnUnhandled(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        // Un errore imprevisto nell'interfaccia non deve chiudere la TV mentre la si guarda.
        Log.Write("Errore UI", e.Exception);
        e.Handled = true;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstance?.Dispose();
        _running?.Dispose();
        base.OnExit(e);
    }
}
