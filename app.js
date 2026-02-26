// =========================================================================
// EventBus — Observer Pattern
// Decouples components via publish/subscribe messaging
// =========================================================================
class EventBus {
  constructor() {
    this._listeners = new Map();
    this._history = [];
  }

  on(event, callback, context = null) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push({ callback, context });
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners.has(event)) return;
    const filtered = this._listeners.get(event).filter(l => l.callback !== callback);
    this._listeners.set(event, filtered);
  }

  emit(event, data = null) {
    this._history.push({ event, data, timestamp: Date.now() });
    if (this._history.length > 100) this._history.shift();

    if (!this._listeners.has(event)) return;
    for (const listener of this._listeners.get(event)) {
      try {
        listener.callback.call(listener.context, data);
      } catch (err) {
        console.error(`EventBus error in "${event}":`, err);
      }
    }
  }

  getHistory() {
    return [...this._history];
  }
}


// =========================================================================
// TodoItem — Domain Model / Entity
// Value object representing a single todo with validation
// =========================================================================
class TodoItem {
  static PRIORITIES = ['high', 'medium', 'low'];
  static PRIORITY_WEIGHTS = { high: 3, medium: 2, low: 1 };

  constructor({ id = null, text, priority = 'medium', done = false, createdAt = null, updatedAt = null }) {
    this.id = id || TodoItem._generateId();
    this.text = text;
    this.priority = TodoItem.PRIORITIES.includes(priority) ? priority : 'medium';
    this.done = Boolean(done);
    this.createdAt = createdAt || Date.now();
    this.updatedAt = updatedAt || Date.now();

    this.validate();
  }

  validate() {
    if (typeof this.text !== 'string' || this.text.trim().length === 0) {
      throw new ValidationError('Todo text cannot be empty');
    }
    if (this.text.length > 500) {
      throw new ValidationError('Todo text cannot exceed 500 characters');
    }
  }

  toggleDone() {
    this.done = !this.done;
    this.updatedAt = Date.now();
    return this;
  }

  updateText(newText) {
    this.text = newText;
    this.updatedAt = Date.now();
    this.validate();
    return this;
  }

  updatePriority(newPriority) {
    if (!TodoItem.PRIORITIES.includes(newPriority)) {
      throw new ValidationError(`Invalid priority: ${newPriority}`);
    }
    this.priority = newPriority;
    this.updatedAt = Date.now();
    return this;
  }

  getPriorityWeight() {
    return TodoItem.PRIORITY_WEIGHTS[this.priority];
  }

  toJSON() {
    return {
      id: this.id,
      text: this.text,
      priority: this.priority,
      done: this.done,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromJSON(json) {
    return new TodoItem(json);
  }

  static _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}


// =========================================================================
// ValidationError — Custom Error
// =========================================================================
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}


// =========================================================================
// StorageAdapter — Interface / Port (Dependency Inversion)
// Abstract base for persistence. Concrete implementations below.
// =========================================================================
class StorageAdapter {
  load(_key) { throw new Error('StorageAdapter.load() not implemented'); }
  save(_key, _data) { throw new Error('StorageAdapter.save() not implemented'); }
  clear(_key) { throw new Error('StorageAdapter.clear() not implemented'); }
}

class LocalStorageAdapter extends StorageAdapter {
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('LocalStorageAdapter: failed to load', e);
      return null;
    }
  }

  save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('LocalStorageAdapter: failed to save', e);
    }
  }

  clear(key) {
    localStorage.removeItem(key);
  }
}

class InMemoryStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this._store = new Map();
  }

  load(key) {
    return this._store.has(key) ? JSON.parse(JSON.stringify(this._store.get(key))) : null;
  }

  save(key, data) {
    this._store.set(key, JSON.parse(JSON.stringify(data)));
  }

  clear(key) {
    this._store.delete(key);
  }
}


// =========================================================================
// TodoRepository — Repository Pattern
// Manages the collection of TodoItems with CRUD operations
// Depends on StorageAdapter (injected) for persistence
// =========================================================================
class TodoRepository {
  constructor(storageAdapter, storageKey = 'todos_v2') {
    this._storage = storageAdapter;
    this._storageKey = storageKey;
    this._items = new Map();

    this._loadFromStorage();
  }

  _loadFromStorage() {
    const data = this._storage.load(this._storageKey);
    if (Array.isArray(data)) {
      for (const raw of data) {
        try {
          const item = TodoItem.fromJSON(raw);
          this._items.set(item.id, item);
        } catch (e) {
          console.warn('Skipping invalid todo item:', raw, e);
        }
      }
    }
  }

  _persist() {
    const data = Array.from(this._items.values()).map(item => item.toJSON());
    this._storage.save(this._storageKey, data);
  }

  add(item) {
    if (!(item instanceof TodoItem)) {
      throw new TypeError('Expected TodoItem instance');
    }
    this._items.set(item.id, item);
    this._persist();
    return item;
  }

  getById(id) {
    return this._items.get(id) || null;
  }

  getAll() {
    return Array.from(this._items.values());
  }

  update(id, updateFn) {
    const item = this._items.get(id);
    if (!item) throw new Error(`Todo not found: ${id}`);
    updateFn(item);
    this._persist();
    return item;
  }

  remove(id) {
    const existed = this._items.delete(id);
    if (existed) this._persist();
    return existed;
  }

  removeWhere(predicate) {
    const toRemove = [];
    for (const [id, item] of this._items) {
      if (predicate(item)) toRemove.push(id);
    }
    for (const id of toRemove) this._items.delete(id);
    if (toRemove.length > 0) this._persist();
    return toRemove.length;
  }

  count() {
    return this._items.size;
  }

  countWhere(predicate) {
    let n = 0;
    for (const item of this._items.values()) {
      if (predicate(item)) n++;
    }
    return n;
  }
}


// =========================================================================
// FilterStrategy — Strategy Pattern
// Encapsulates filtering logic so it can be swapped at runtime
// =========================================================================
class FilterStrategy {
  apply(_items) { throw new Error('FilterStrategy.apply() not implemented'); }
  get name() { return 'base'; }
}

class AllFilter extends FilterStrategy {
  apply(items) { return items; }
  get name() { return 'all'; }
}

class ActiveFilter extends FilterStrategy {
  apply(items) { return items.filter(i => !i.done); }
  get name() { return 'active'; }
}

class CompletedFilter extends FilterStrategy {
  apply(items) { return items.filter(i => i.done); }
  get name() { return 'completed'; }
}


// =========================================================================
// SortStrategy — Strategy Pattern
// Encapsulates sorting logic
// =========================================================================
class SortStrategy {
  apply(_items) { throw new Error('SortStrategy.apply() not implemented'); }
  get name() { return 'base'; }
}

class NewestFirstSort extends SortStrategy {
  apply(items) { return [...items].sort((a, b) => b.createdAt - a.createdAt); }
  get name() { return 'newest'; }
}

class OldestFirstSort extends SortStrategy {
  apply(items) { return [...items].sort((a, b) => a.createdAt - b.createdAt); }
  get name() { return 'oldest'; }
}

class PrioritySort extends SortStrategy {
  apply(items) { return [...items].sort((a, b) => b.getPriorityWeight() - a.getPriorityWeight()); }
  get name() { return 'priority'; }
}


// =========================================================================
// SearchService — Single Responsibility
// Handles text search/filtering of todo items
// =========================================================================
class SearchService {
  constructor() {
    this._query = '';
  }

  setQuery(query) {
    this._query = query.toLowerCase().trim();
  }

  getQuery() {
    return this._query;
  }

  apply(items) {
    if (!this._query) return items;
    return items.filter(item =>
      item.text.toLowerCase().includes(this._query)
    );
  }
}


// =========================================================================
// StatsCalculator — Single Responsibility
// Computes aggregate statistics from the repository
// =========================================================================
class StatsCalculator {
  constructor(repository) {
    this._repo = repository;
  }

  compute() {
    const all = this._repo.getAll();
    const total = all.length;
    const completed = all.filter(i => i.done).length;
    const active = total - completed;
    const highPriority = all.filter(i => !i.done && i.priority === 'high').length;

    return { total, completed, active, highPriority };
  }
}


// =========================================================================
// NotificationService — Manages toast notifications
// =========================================================================
class NotificationService {
  constructor(elementId) {
    this._el = document.getElementById(elementId);
    this._timeout = null;
  }

  show(message, type = 'info', duration = 2500) {
    if (this._timeout) clearTimeout(this._timeout);

    this._el.textContent = message;
    this._el.className = `notification ${type} show`;

    this._timeout = setTimeout(() => {
      this._el.classList.remove('show');
    }, duration);
  }

  success(message) { this.show(message, 'success'); }
  error(message) { this.show(message, 'error'); }
  info(message) { this.show(message, 'info'); }
}


// =========================================================================
// TodoRenderer — View / Presentation Layer
// Responsible only for rendering the UI from data
// =========================================================================
class TodoRenderer {
  constructor(listElementId, statsElementId) {
    this._listEl = document.getElementById(listElementId);
    this._statsEl = document.getElementById(statsElementId);
  }

  renderList(items) {
    if (items.length === 0) {
      this._listEl.innerHTML = '<li class="empty-state">No todos to show.</li>';
      return;
    }

    this._listEl.innerHTML = items.map(item => this._renderItem(item)).join('');
  }

  renderStats(stats) {
    const parts = [
      `${stats.total} total`,
      `${stats.active} active`,
      `${stats.completed} done`,
    ];
    if (stats.highPriority > 0) {
      parts.push(`${stats.highPriority} high priority`);
    }
    this._statsEl.textContent = parts.join(' · ');
  }

  _renderItem(item) {
    const doneClass = item.done ? 'done' : '';
    const priorityClass = `priority-${item.priority}`;
    const timeAgo = this._formatTimeAgo(item.createdAt);

    return `
      <li class="${doneClass} ${priorityClass}" data-id="${item.id}">
        <input type="checkbox" ${item.done ? 'checked' : ''}>
        <div class="todo-content">
          <span class="todo-text">${this._escapeHtml(item.text)}</span>
          <div class="todo-meta">
            <span class="priority-badge ${item.priority}">${item.priority}</span>
            · ${timeAgo}
          </div>
        </div>
        <div class="todo-actions">
          <button class="edit-btn" title="Edit">&#9998;</button>
          <button class="delete-btn" title="Delete">&times;</button>
        </div>
      </li>
    `;
  }

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  _formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}


// =========================================================================
// EditModalController — Manages the edit modal dialog
// =========================================================================
class EditModalController {
  constructor(overlayId, textInputId, priorityInputId, saveBtnId, cancelBtnId) {
    this._overlay = document.getElementById(overlayId);
    this._textInput = document.getElementById(textInputId);
    this._priorityInput = document.getElementById(priorityInputId);
    this._saveBtn = document.getElementById(saveBtnId);
    this._cancelBtn = document.getElementById(cancelBtnId);

    this._currentItemId = null;
    this._onSaveCallback = null;

    this._cancelBtn.addEventListener('click', () => this.close());
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.close();
    });
    this._saveBtn.addEventListener('click', () => this._handleSave());
    this._textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleSave();
      if (e.key === 'Escape') this.close();
    });
  }

  open(item, onSaveCallback) {
    this._currentItemId = item.id;
    this._textInput.value = item.text;
    this._priorityInput.value = item.priority;
    this._onSaveCallback = onSaveCallback;
    this._overlay.classList.add('open');
    this._textInput.focus();
    this._textInput.select();
  }

  close() {
    this._overlay.classList.remove('open');
    this._currentItemId = null;
    this._onSaveCallback = null;
  }

  _handleSave() {
    if (this._onSaveCallback && this._currentItemId) {
      this._onSaveCallback(this._currentItemId, {
        text: this._textInput.value.trim(),
        priority: this._priorityInput.value,
      });
    }
    this.close();
  }
}


// =========================================================================
// TodoController — Application Controller / Mediator
// Orchestrates all components; handles user actions and coordinates updates
// =========================================================================
class TodoController {
  constructor({ repository, renderer, eventBus, notificationService, statsCalculator, searchService, editModal }) {
    this._repo = repository;
    this._renderer = renderer;
    this._eventBus = eventBus;
    this._notifications = notificationService;
    this._stats = statsCalculator;
    this._search = searchService;
    this._editModal = editModal;

    this._filterStrategy = new AllFilter();
    this._sortStrategy = new NewestFirstSort();

    this._filterMap = {
      all: new AllFilter(),
      active: new ActiveFilter(),
      completed: new CompletedFilter(),
    };

    this._sortMap = {
      newest: new NewestFirstSort(),
      oldest: new OldestFirstSort(),
      priority: new PrioritySort(),
    };

    this._subscribeToEvents();
  }

  _subscribeToEvents() {
    this._eventBus.on('todo:add', (data) => this.addTodo(data));
    this._eventBus.on('todo:toggle', (id) => this.toggleTodo(id));
    this._eventBus.on('todo:delete', (id) => this.deleteTodo(id));
    this._eventBus.on('todo:edit', (id) => this.openEditModal(id));
    this._eventBus.on('todo:update', ({ id, updates }) => this.updateTodo(id, updates));
    this._eventBus.on('filter:change', (filterName) => this.setFilter(filterName));
    this._eventBus.on('sort:change', (sortName) => this.setSort(sortName));
    this._eventBus.on('search:change', (query) => this.setSearch(query));
    this._eventBus.on('bulk:clearCompleted', () => this.clearCompleted());
  }

  addTodo({ text, priority }) {
    try {
      const item = new TodoItem({ text, priority });
      this._repo.add(item);
      this._eventBus.emit('todo:added', item);
      this._notifications.success('Todo added');
      this.refresh();
    } catch (err) {
      if (err instanceof ValidationError) {
        this._notifications.error(err.message);
      } else {
        throw err;
      }
    }
  }

  toggleTodo(id) {
    try {
      this._repo.update(id, (item) => item.toggleDone());
      this._eventBus.emit('todo:toggled', id);
      this.refresh();
    } catch (err) {
      this._notifications.error('Failed to toggle todo');
    }
  }

  deleteTodo(id) {
    const removed = this._repo.remove(id);
    if (removed) {
      this._eventBus.emit('todo:deleted', id);
      this._notifications.info('Todo deleted');
      this.refresh();
    }
  }

  openEditModal(id) {
    const item = this._repo.getById(id);
    if (!item) return;
    this._editModal.open(item, (itemId, updates) => {
      this._eventBus.emit('todo:update', { id: itemId, updates });
    });
  }

  updateTodo(id, { text, priority }) {
    try {
      this._repo.update(id, (item) => {
        if (text !== undefined) item.updateText(text);
        if (priority !== undefined) item.updatePriority(priority);
      });
      this._eventBus.emit('todo:updated', id);
      this._notifications.success('Todo updated');
      this.refresh();
    } catch (err) {
      if (err instanceof ValidationError) {
        this._notifications.error(err.message);
      }
    }
  }

  setFilter(filterName) {
    if (this._filterMap[filterName]) {
      this._filterStrategy = this._filterMap[filterName];
      this._eventBus.emit('filter:changed', filterName);
      this.refresh();
    }
  }

  setSort(sortName) {
    if (this._sortMap[sortName]) {
      this._sortStrategy = this._sortMap[sortName];
      this._eventBus.emit('sort:changed', sortName);
      this.refresh();
    }
  }

  setSearch(query) {
    this._search.setQuery(query);
    this.refresh();
  }

  clearCompleted() {
    const count = this._repo.removeWhere(item => item.done);
    if (count > 0) {
      this._notifications.info(`Cleared ${count} completed todo${count > 1 ? 's' : ''}`);
      this.refresh();
    }
  }

  refresh() {
    let items = this._repo.getAll();
    items = this._filterStrategy.apply(items);
    items = this._search.apply(items);
    items = this._sortStrategy.apply(items);

    this._renderer.renderList(items);
    this._renderer.renderStats(this._stats.compute());
  }
}


// =========================================================================
// InputHandler — Binds DOM events to EventBus emissions
// Keeps DOM event wiring separate from business logic
// =========================================================================
class InputHandler {
  constructor(eventBus) {
    this._eventBus = eventBus;
    this._bindAddForm();
    this._bindListClicks();
    this._bindFilters();
    this._bindSortButtons();
    this._bindSearch();
    this._bindBulkActions();
  }

  _bindAddForm() {
    const input = document.getElementById('todoInput');
    const prioritySelect = document.getElementById('priorityInput');
    const addBtn = document.getElementById('addBtn');

    const emitAdd = () => {
      const text = input.value.trim();
      if (!text) return;
      this._eventBus.emit('todo:add', { text, priority: prioritySelect.value });
      input.value = '';
      input.focus();
    };

    addBtn.addEventListener('click', emitAdd);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') emitAdd();
    });
  }

  _bindListClicks() {
    const list = document.getElementById('todoList');

    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const id = li.dataset.id;

      if (e.target.type === 'checkbox') {
        this._eventBus.emit('todo:toggle', id);
      } else if (e.target.classList.contains('delete-btn')) {
        this._eventBus.emit('todo:delete', id);
      } else if (e.target.classList.contains('edit-btn')) {
        this._eventBus.emit('todo:edit', id);
      }
    });
  }

  _bindButtonGroup(selector, eventName, datasetKey) {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._eventBus.emit(eventName, btn.dataset[datasetKey]);
      });
    });
  }

  _bindFilters() {
    this._bindButtonGroup('.filter-group button', 'filter:change', 'filter');
  }

  _bindSortButtons() {
    this._bindButtonGroup('.sort-group button', 'sort:change', 'sort');
  }

  _bindSearch() {
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this._eventBus.emit('search:change', searchInput.value);
      }, 200);
    });
  }

  _bindBulkActions() {
    document.getElementById('clearCompletedBtn')
      .addEventListener('click', () => this._eventBus.emit('bulk:clearCompleted'));
  }
}


// =========================================================================
// Application — Composition Root / Bootstrap
// Wires everything together with dependency injection
// =========================================================================
class Application {
  constructor() {
    this._eventBus = new EventBus();
    this._storage = new LocalStorageAdapter();
    this._repository = new TodoRepository(this._storage);
    this._renderer = new TodoRenderer('todoList', 'statsBar');
    this._notifications = new NotificationService('notification');
    this._statsCalculator = new StatsCalculator(this._repository);
    this._searchService = new SearchService();
    this._editModal = new EditModalController(
      'editModal', 'editTextInput', 'editPriorityInput', 'editSaveBtn', 'editCancelBtn'
    );

    this._controller = new TodoController({
      repository: this._repository,
      renderer: this._renderer,
      eventBus: this._eventBus,
      notificationService: this._notifications,
      statsCalculator: this._statsCalculator,
      searchService: this._searchService,
      editModal: this._editModal,
    });

    this._inputHandler = new InputHandler(this._eventBus);
  }

  start() {
    this._controller.refresh();
    console.log('Todo application initialized');
  }
}

// Boot
const app = new Application();
app.start();
