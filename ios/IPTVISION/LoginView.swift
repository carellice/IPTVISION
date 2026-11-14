import SwiftUI

/// Accesso con un account Xtream Codes (o con il link M3U completo) e scelta delle liste già salvate.
struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    var isSheet = false

    @State var server = ""
    @State var user = ""
    @State var pass = ""
    @State var alias = ""
    @State var connecting = false

    var body: some View {
        NavigationStack {
            Form {
                if !isSheet {
                    Section {
                        VStack(spacing: 8) {
                            Image(systemName: "play.tv.fill").font(.system(size: 48)).foregroundStyle(Theme.accent)
                            Text("IPTVISION").font(.largeTitle.bold())
                            Text("TV in diretta, film e serie dal tuo account Xtream Codes.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    }
                }
                if !isSheet && model.homeServer == nil && !model.lists.isEmpty {
                    Section("Liste salvate") {
                        ForEach(model.lists) { l in
                            Button { model.use(l) } label: {
                                VStack(alignment: .leading) {
                                    Text(l.alias).foregroundStyle(.primary)
                                    Text("\(l.username) · \(l.server)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { $0.map { model.lists[$0] }.forEach(model.removeList) }
                    }
                }
                Section {
                    TextField("Server (es. http://server:8080) o link M3U", text: $server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Nome utente", text: $user).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $pass)
                    TextField("Nome della lista (facoltativo)", text: $alias)
                } header: {
                    Text(isSheet ? "Nuova lista" : "Accedi")
                } footer: {
                    Text("Se incolli il link M3U completo (get.php?username=…&password=…), utente e password si compilano da soli. IPTVISION è solo un lettore e non contiene canali.")
                }
                if let e = model.loginError {
                    Section { Text(e).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task {
                            await model.login(serverInput: server, user: user, pass: pass, alias: alias)
                            if model.loginError == nil && isSheet { dismiss() }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if model.loginBusy { ProgressView() } else { Text("Accedi").bold() }
                            Spacer()
                        }
                    }
                    .disabled(model.loginBusy || server.isEmpty)
                }
                if !isSheet {
                    Section {
                        Button { connecting = true } label: { Label("Usa il server di casa", systemImage: "server.rack") }
                    } footer: {
                        Text("Con IPTVISION installato su CasaOS non serve inserire qui l'account IPTV.")
                    }
                }
            }
            .navigationTitle(isSheet ? "Aggiungi lista" : "")
            .sheet(isPresented: $connecting) { ServerView().environmentObject(model) }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if isSheet { ToolbarItem(placement: .cancellationAction) { Button("Annulla") { dismiss() } } }
            }
        }
    }
}
