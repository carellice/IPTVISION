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
