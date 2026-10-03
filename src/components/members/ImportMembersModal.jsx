import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Users,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import {
  buildImportRows,
  flagExistingDuplicates,
  summarizeImportRows,
  rejectedImportRows,
} from '../../utils/memberImport';
import { memberService } from '../../services/memberService';

const SAMPLE_MEMBERS = [
  {
    'Full Name': 'Kasun Kalhara Perera',
    'NIC Number': '199512345678',
    Phone: '0771234567',
    'WhatsApp Number': '0771234567',
    Email: 'kasun@gmail.com',
    District: 'Colombo',
    Address: 'No. 45, Temple Road, Nugegoda',
    Gender: 'Male',
    'Date of Birth': '1995-05-14',
    'Emergency Contact': '0777654321',
    'Medical Conditions': 'None',
  },
  {
    'Full Name': 'Dilhani Silva',
    'NIC Number': '987654321V',
    Phone: '0719876543',
    'WhatsApp Number': '0719876543',
    Email: 'dilhani@yahoo.com',
    District: 'Gampaha',
    Address: 'Main Street, Negombo',
    Gender: 'Female',
    'Date of Birth': '1998-11-20',
    'Emergency Contact': '0712223334',
    'Medical Conditions': 'Asthma',
  },
];

export function ImportMembersModal({ isOpen, onClose, plans = [], currency, onImportComplete }) {
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState('');
  const [importSummary, setImportSummary] = useState(null);

  const fileInputRef = useRef(null);

  const downloadTemplate = (format = 'xlsx') => {
    const ws = XLSX.utils.json_to_sheet(SAMPLE_MEMBERS);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members Import');

    if (format === 'csv') {
      XLSX.writeFile(wb, 'Be_Smart_Gym_Member_Import_Template.csv', { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, 'Be_Smart_Gym_Member_Import_Template.xlsx');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    parseFile(selectedFile);
  };

  const parseFile = async (uploadFile) => {
    setIsParsing(true);
    setError('');
    setImportSummary(null);

    try {
      const buffer = await uploadFile.arrayBuffer();
      // cellDates hands back real Date objects for date-formatted cells instead
      // of raw serial numbers, so a date of birth survives the round trip.
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (rawJson.length === 0) {
        setError('The uploaded spreadsheet contains no data rows.');
        setParsedRows([]);
        return;
      }

      // Field rules first, then repeats inside the file.
      const normalized = buildImportRows(rawJson);

      // Then the numbers already on file. members.phone has no unique
      // constraint, so this check is the only thing stopping a re-imported
      // sheet from creating a second member for every row.
      const existingPhoneKeys = await memberService.getExistingPhoneKeys();
      setParsedRows(flagExistingDuplicates(normalized, existingPhoneKeys));
    } catch (err) {
      setError(
        err?.message ||
          'Failed to read the file. Please ensure it is a valid .xlsx, .xls or .csv file.'
      );
      setParsedRows([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleStartImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      setError('No valid rows found to import.');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    setError('');

    try {
      const summary = await onImportComplete({
        rows: validRows,
        planId: selectedPlanId || null,
        paymentMethod: paymentMethod,
        onProgress: (current, total) => {
          setImportProgress(Math.round((current / total) * 100));
        },
      });

      setImportSummary(summary);
    } catch (err) {
      setError(err?.message || 'Bulk import failed. Please check database connection.');
    } finally {
      setIsImporting(false);
    }
  };

  const resetModal = () => {
    setFile(null);
    setParsedRows([]);
    setSelectedPlanId('');
    setError('');
    setImportSummary(null);
    setImportProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  // Duplicates are shown as their own count because they need a different fix in
  // the spreadsheet than a bad district does, but they are also part of the
  // invalid total: a duplicate is never inserted.
  const counts = summarizeImportRows(parsedRows);
  const rejected = rejectedImportRows(parsedRows);
  const validCount = counts.valid;
  const invalidCount = counts.invalid;
  const duplicateCount = counts.duplicate;

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetModal}
      title="Import Members from Excel / Google Sheets"
      className="max-w-4xl"
    >
      <div className="space-y-6">
        {/* Step 1 Header & Downloads */}
        <div className="p-4 rounded-xl bg-gym-850/60 border border-hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-brand-gold" />
              Download Sample Import Template
            </h4>
            <p className="text-xs text-slate-400">
              Export your Google Sheet or Excel file using our standard columns format.
            </p>
            <p className="text-[11px] text-slate-500">
              District must be one of the 25 Sri Lankan districts and Gender must be Male, Female or
              Other. Capitalisation and extra spaces do not matter. Leave either column blank to
              leave it unset, but a value that is not recognised rejects the row instead of being
              guessed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => downloadTemplate('xlsx')}
            >
              Excel (.xlsx)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => downloadTemplate('csv')}
            >
              CSV (.csv)
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        {/* Upload Drop Zone */}
        {!importSummary && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gym-700 hover:border-brand-cyan/60 rounded-xl p-8 text-center cursor-pointer bg-gym-950/50 hover:bg-gym-850/40 transition flex flex-col items-center justify-center space-y-3"
            >
              <div className="p-3 rounded-full bg-gym-800 text-brand-cyan">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {file ? file.name : 'Click to select or drop your Excel / CSV file here'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Microsoft Excel (.xlsx, .xls) and Google Sheets CSV exports.
                </p>
              </div>
            </div>

            {/* Optional Plan assignment */}
            {parsedRows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-gym-850/40 border border-hairline">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Assign Plan to Imported Members (Optional)
                  </label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                  >
                    <option value="">No Plan (Register Member Only)</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(p.price, currency)} / {p.duration_days} days)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPlanId && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Card">Card</option>
                      <option value="Bank_Transfer">Bank Transfer</option>
                      <option value="Online">Online Wallet</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Parsed Rows Preview */}
        {isParsing ? (
          <div className="text-center py-8 space-y-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-brand-cyan" />
            <p className="text-xs">Parsing spreadsheet rows...</p>
          </div>
        ) : parsedRows.length > 0 && !importSummary ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-cyan" />
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Spreadsheet Preview
                </h4>
              </div>
            </div>

            {/* The four counts, always all four, so the numbers can be checked
                against each other before anything is written. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-hairline bg-gym-850/40 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Total Rows</p>
                <p className="text-lg font-bold font-mono text-slate-100">{counts.total}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-emerald-400/80">
                  Valid Rows
                </p>
                <p className="text-lg font-bold font-mono text-emerald-400">{counts.valid}</p>
              </div>
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-rose-400/80">
                  Invalid Rows
                </p>
                <p className="text-lg font-bold font-mono text-rose-400">{counts.invalid}</p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-amber-400/80">
                  Duplicate Rows
                </p>
                <p className="text-lg font-bold font-mono text-amber-400">{counts.duplicate}</p>
              </div>
            </div>

            {duplicateCount > 0 && duplicateCount < invalidCount && (
              <p className="text-[11px] text-slate-400">
                {duplicateCount} of the {invalidCount} invalid rows are duplicate phone numbers.
              </p>
            )}

            <div className="max-h-64 overflow-y-auto rounded-lg border border-hairline bg-gym-950">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gym-900 border-b border-hairline text-slate-400 sticky top-0">
                    <th className="p-2.5">Row</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Full Name</th>
                    <th className="p-2.5">NIC</th>
                    <th className="p-2.5">Mobile Phone</th>
                    <th className="p-2.5">District</th>
                    <th className="p-2.5">Gender</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {parsedRows.map((row) => (
                    <tr
                      key={row.excelRow}
                      className={row.isValid ? 'hover:bg-gym-900/50' : 'bg-rose-500/5'}
                    >
                      <td className="p-2.5 font-mono text-slate-500">{row.excelRow}</td>
                      <td className="p-2.5">
                        {row.isValid ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <div
                            className="flex items-center gap-1 text-rose-400"
                            title={row.errors.join(', ')}
                          >
                            <XCircle className="w-4 h-4 shrink-0" />
                            <span className="text-[10px]">{row.errors[0]}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 font-medium text-slate-100">{row.full_name || '—'}</td>
                      <td className="p-2.5 text-slate-300 font-mono">{row.nic_number || '—'}</td>
                      <td className="p-2.5 text-slate-300">{row.phone || '—'}</td>
                      <td className="p-2.5 text-slate-400">{row.district || '—'}</td>
                      <td className="p-2.5 text-slate-400">{row.gender || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Every rejected row, with the spreadsheet row number and the exact
                reason, so the file can be corrected without guessing. */}
            {rejected.length > 0 && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rose-500/20">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <h5 className="text-xs font-semibold text-rose-300">
                    Rows that will NOT be imported ({rejected.length})
                  </h5>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gym-900/60 border-b border-hairline text-slate-400">
                        <th className="p-2.5 w-16">Row</th>
                        <th className="p-2.5">Member Name</th>
                        <th className="p-2.5">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {rejected.map((row) => (
                        <tr key={row.excelRow} className="hover:bg-gym-900/40">
                          <td className="p-2.5 font-mono text-slate-400">{row.excelRow}</td>
                          <td className="p-2.5 font-medium text-slate-200">{row.name}</td>
                          <td className="p-2.5 text-rose-300">{row.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Import Progress Bar */}
            {isImporting && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Importing members into database...</span>
                  <span className="font-mono font-bold text-brand-gold">{importProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-gym-800 overflow-hidden">
                  <div
                    className="h-full bg-brand-gold transition-all duration-300"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Import Summary Results */}
        {importSummary && (
          <div className="text-center py-6 space-y-4">
            <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-block">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Bulk Import Complete!</h3>
              <p className="text-xs text-slate-300 mt-1">
                Successfully registered{' '}
                <span className="font-bold text-brand-cyan">{importSummary.successCount}</span>{' '}
                members from your spreadsheet.
              </p>
              {rejected.length > 0 && (
                <p className="text-xs text-amber-400 mt-1">
                  {rejected.length} row{rejected.length !== 1 ? 's were' : ' was'} skipped before
                  importing because of the problems listed above.
                </p>
              )}
              {importSummary.errorCount > 0 && (
                <p className="text-xs text-rose-400 mt-1">
                  {importSummary.errorCount} row
                  {importSummary.errorCount !== 1 ? 's' : ''} could not be saved and need to be
                  retried.
                </p>
              )}
            </div>
            <Button variant="primary" className="w-full" onClick={resetModal}>
              Done & View Members
            </Button>
          </div>
        )}

        {/* Modal Action Buttons */}
        {!importSummary && (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-hairline">
            <Button variant="secondary" onClick={resetModal} disabled={isImporting}>
              Cancel
            </Button>
            <Button
              variant="emerald"
              icon={Upload}
              onClick={handleStartImport}
              disabled={parsedRows.length === 0 || validCount === 0 || isImporting}
            >
              {isImporting
                ? 'Importing...'
                : `Import ${validCount} Member${validCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
