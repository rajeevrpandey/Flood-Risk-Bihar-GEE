
//extract the BIHAR state from table2

var Bihar = table2.filter(ee.Filter.eq("STATE","BIH>R"));
Map.addLayer(Bihar,{}, 'Bihar');
Map.centerObject(Bihar);
//import the satellite image collection

var collection = ee.ImageCollection("COPERNICUS/S1_GRD")
.filterBounds(Bihar)
.filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
.select('VV');

//filter the before and after flood imagery

var before = collection.filterDate("2019-01-01","2019-01-15").mosaic();
var after = collection.filterDate("2019-06-01","2019-07-30").mosaic();

var before_clip = before.clip(Bihar);
var after_clip = after.clip(Bihar);
//apply smoothening filter (remove spekle noise)
var before_s = before_clip.focal_median(30, "circle", "meters");
var after_s = after_clip.focal_median(30, "circle", "meters");
//diffrence
var difference = after_s.subtract(before_s);
//difference is clipped to Bihar region
var S1 = difference.clip(Bihar);
//histogram of the VV polarization values
var histogram =S1.select('VV').reduceRegion({
  reducer: ee.Reducer.histogram(255, 2),  //this reducer computes a histogram of pixel values within the specified region
  geometry: Bihar, //specifies the region of interest
  scale: 20,  //scale corresponds to the spatial resolution (in meters) at which to aggregate the pixel values
  bestEffort: true  // system will make a best effort to execute the reduction, even if the geometry is too large to process in a single computation
});
/*
The reduceRegion method in Google Earth Engine is used to compute a statistic or aggregation
over a specified region of an image or image collection. 
This method is particularly useful for extracting summary statistics, histograms, 
or other aggregated information from geospatial data within a specific geographic region. 
*/

//Printing the Histogram
print(histogram);

var otsu = function(histogram) {
  var counts = ee.Array(ee.Dictionary(histogram).get('histogram')); //Number of pixels in each histogram bin
  var means = ee.Array(ee.Dictionary(histogram).get('bucketMeans')); //Center value (mean) of each histogram bin
  var size = means.length().get([0]); //Number of bins
  var total = counts.reduce(ee.Reducer.sum(), [0]).get([0]); //Total number of pixels
  var sum = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]); //Weighted sum of all pixel values (value × count)
  var mean = sum.divide(total); //Global mean
  
  var indices = ee.List.sequence(1, size);
  //Creates a list of possible threshold indices
  
  var bss = indices.map(function(i) {
    //runs for each potential threshold and calculates Between-Class Variance (BSS)
    var aCounts = counts.slice(0, 0, i);
    var aCount = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
    var aMeans = means.slice(0, 0, i);
    var aMean = aMeans.multiply(aCounts)
        .reduce(ee.Reducer.sum(), [0]).get([0])
        .divide(aCount);
    var bCount = total.subtract(aCount);
    var bMean = sum.subtract(aCount.multiply(aMean)).divide(bCount);
    return aCount.multiply(aMean.subtract(mean).pow(2)).add(
           bCount.multiply(bMean.subtract(mean).pow(2)));
  });
  
  print(ui.Chart.array.values(ee.Array(bss), 0, means));
  
  
  return means.sort(bss).get([-1]);
  // Returns the mean (value) that gives the maximum BSS (optimal threshold)
};

var threshold = otsu(histogram.get('VV')); //Applies the Otsu method to the VV histogram
print('threshold', threshold);

//Identifies flood-affected pixels where the value is less than the Otsu threshold
var flood_extent = S1.select('VV').lt(threshold);

Map.addLayer(flood_extent.selfMask(), {palette: 'Blue'}, 'Flood');
var flood = flood_extent.updateMask(flood_extent);


// Import GPWv411: Basic Demographic Characteristics (Gridded Population of the World Version 4.11)
var population_data = ee.ImageCollection('CIESIN/GPWv411/GPW_Basic_Demographic_Characteristics').first();
var bihar_population_data = population_data.select('basic_demographic_characteristics').clip(Bihar);
var bihar_population_data_vis = {
  'max': 1000.0,
  'palette': [
    'ffffe7',
    '86a192',
    '509791',
    '307296',
    '2c4484',
    '000066'
  ],
  'min': 0.0
};
Map.addLayer(bihar_population_data, bihar_population_data_vis, 'Population Density', 0);

//extract the BIHAR districts from table
var Districts = table.filter(ee.Filter.eq("STATE","BIH>R"));

//District's total population calculation
var scale = bihar_population_data.projection().nominalScale();  //nominal scale is the pixel resolution, or the size of each pixel, in the spatial reference system used by the image
var districtSums = bihar_population_data.reduceRegions({  //Reduce the population data for each district
  collection: Districts,
  reducer: ee.Reducer.sum(),  //because we are using population density map 
  scale: scale,
});

//District's affected population calculation
var Affected_population = bihar_population_data.multiply(flood_extent); //combining population data with flood data
var scale = Affected_population.projection().nominalScale();
var districtAffectedSums = Affected_population.reduceRegions({
  collection: Districts,
  reducer: ee.Reducer.sum(),
  scale: scale,
});

// Coloring the districts according to population affected
var palettes = require('users/gena/packages:palettes'); //Import colour palette
var colours = palettes.colorbrewer.Paired[6];
var blank_map = ee.Image().byte();        //Create a blank image
var coloured_map = blank_map.paint(districtAffectedSums, 'sum').paint(districtAffectedSums, 0, 2);  //filing colours
Map.addLayer(coloured_map, {palette: ['000000'].concat(colours), max: 100000, opacity:0.4}, 'Affected People');  

// Export data to CSV
Export.table.toDrive({
  collection: districtAffectedSums,
  description: 'Affected_population',
  fileFormat: 'CSV'
});

